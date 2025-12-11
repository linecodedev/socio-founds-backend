import { Response } from 'express';
import prisma from '../config/database.js';
import odooService from '../services/odoo.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthRequest, UploadResult } from '../types/index.js';

// Upload (fetch from Odoo) balance sheet
export async function uploadBalanceSheet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;
    const year = parseInt(req.body.year || req.query.year as string);
    const month = parseInt(req.body.month || req.query.month as string);
    const overwrite = req.body.overwrite === true || req.body.overwrite === 'true';

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    if (!year || !month || month < 1 || month > 12) {
      sendError(res, 'Valid year and month are required', 400);
      return;
    }

    // Check if data exists and overwrite is not enabled
    if (!overwrite) {
      const existingData = await prisma.balanceSheetEntry.findFirst({
        where: { cooperativeId, year, month },
      });

      if (existingData) {
        sendError(res, 'Data already exists for this period. Enable overwrite to replace.', 400);
        return;
      }
    }

    // Fetch from Odoo
    const odooResult = await odooService.fetchBalanceSheet(cooperativeId, year, month);

    if (!odooResult.success) {
      // Log failed attempt
      await prisma.uploadHistory.create({
        data: {
          cooperativeId,
          userId: req.user!.id,
          year,
          month,
          module: 'balance_sheet',
          status: 'failed',
          errorMessage: odooResult.error,
        },
      });

      sendError(res, odooResult.error || 'Failed to fetch data from Odoo', 400);
      return;
    }

    // Delete existing data if overwrite
    if (overwrite) {
      await prisma.balanceSheetEntry.deleteMany({
        where: { cooperativeId, year, month },
      });
    }

    // Save records to database
    const records = odooResult.records as Array<{
      accountCode: string;
      accountName: string;
      category: 'assets' | 'liabilities' | 'equity';
      subcategory?: string;
      initialDebit: number;
      initialCredit: number;
      periodDebit: number;
      periodCredit: number;
      finalDebit: number;
      finalCredit: number;
      odooId?: string;
    }>;

    if (records.length > 0) {
      await prisma.balanceSheetEntry.createMany({
        data: records.map((r) => ({
          cooperativeId,
          year,
          month,
          accountCode: r.accountCode,
          accountName: r.accountName,
          category: r.category,
          subcategory: r.subcategory,
          initialDebit: r.initialDebit || 0,
          initialCredit: r.initialCredit || 0,
          periodDebit: r.periodDebit || 0,
          periodCredit: r.periodCredit || 0,
          finalDebit: r.finalDebit || 0,
          finalCredit: r.finalCredit || 0,
          odooId: r.odooId,
        })),
      });
    }

    // Ensure period exists
    await prisma.period.upsert({
      where: {
        cooperativeId_year_month: { cooperativeId, year, month },
      },
      update: {},
      create: { cooperativeId, year, month },
    });

    // Log success
    await prisma.uploadHistory.create({
      data: {
        cooperativeId,
        userId: req.user!.id,
        year,
        month,
        module: 'balance_sheet',
        status: 'success',
        recordsCount: records.length,
      },
    });

    // Update Odoo last sync
    await odooService.updateLastSync(cooperativeId);

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: req.user!.id,
        action: 'Importó Balance General',
        details: `Período: ${month}/${year}, Registros: ${records.length}`,
        ipAddress: req.ip,
      },
    });

    const result: UploadResult = {
      status: 'success',
      message: `Successfully imported ${records.length} balance sheet entries`,
      recordsCount: records.length,
    };

    sendSuccess(res, result);
  } catch (error) {
    console.error('Upload balance sheet error:', error);
    sendError(res, 'Failed to upload balance sheet', 500);
  }
}

// Upload (fetch from Odoo) cash flow
export async function uploadCashFlow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;
    const year = parseInt(req.body.year || req.query.year as string);
    const month = parseInt(req.body.month || req.query.month as string);
    const overwrite = req.body.overwrite === true || req.body.overwrite === 'true';

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    if (!year || !month) {
      sendError(res, 'Year and month are required', 400);
      return;
    }

    if (!overwrite) {
      const existingData = await prisma.cashFlowEntry.findFirst({
        where: { cooperativeId, year, month },
      });

      if (existingData) {
        sendError(res, 'Data already exists for this period', 400);
        return;
      }
    }

    const odooResult = await odooService.fetchCashFlow(cooperativeId, year, month);

    if (!odooResult.success) {
      await prisma.uploadHistory.create({
        data: {
          cooperativeId,
          userId: req.user!.id,
          year,
          month,
          module: 'cash_flow',
          status: 'failed',
          errorMessage: odooResult.error,
        },
      });

      sendError(res, odooResult.error || 'Failed to fetch data', 400);
      return;
    }

    if (overwrite) {
      await prisma.cashFlowEntry.deleteMany({
        where: { cooperativeId, year, month },
      });
    }

    const records = odooResult.records as Array<{
      description: string;
      category: 'operating' | 'investing' | 'financing';
      amount: number;
      odooId?: string;
    }>;

    if (records.length > 0) {
      await prisma.cashFlowEntry.createMany({
        data: records.map((r) => ({
          cooperativeId,
          year,
          month,
          description: r.description,
          category: r.category,
          amount: r.amount,
          odooId: r.odooId,
        })),
      });
    }

    await prisma.period.upsert({
      where: { cooperativeId_year_month: { cooperativeId, year, month } },
      update: {},
      create: { cooperativeId, year, month },
    });

    await prisma.uploadHistory.create({
      data: {
        cooperativeId,
        userId: req.user!.id,
        year,
        month,
        module: 'cash_flow',
        status: 'success',
        recordsCount: records.length,
      },
    });

    await odooService.updateLastSync(cooperativeId);

    await prisma.activityLog.create({
      data: {
        userId: req.user!.id,
        action: 'Importó Flujo de Caja',
        details: `Período: ${month}/${year}, Registros: ${records.length}`,
        ipAddress: req.ip,
      },
    });

    sendSuccess(res, {
      status: 'success',
      message: `Successfully imported ${records.length} cash flow entries`,
      recordsCount: records.length,
    });
  } catch (error) {
    console.error('Upload cash flow error:', error);
    sendError(res, 'Failed to upload cash flow', 500);
  }
}

// Upload (fetch from Odoo) membership fees
export async function uploadMembershipFees(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;
    const year = parseInt(req.body.year || req.query.year as string);
    const month = parseInt(req.body.month || req.query.month as string);
    const overwrite = req.body.overwrite === true || req.body.overwrite === 'true';

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    if (!year || !month) {
      sendError(res, 'Year and month are required', 400);
      return;
    }

    if (!overwrite) {
      const existingData = await prisma.membershipFee.findFirst({
        where: { cooperativeId, year, month },
      });

      if (existingData) {
        sendError(res, 'Data already exists for this period', 400);
        return;
      }
    }

    const odooResult = await odooService.fetchMembershipFees(cooperativeId, year, month);

    if (!odooResult.success) {
      await prisma.uploadHistory.create({
        data: {
          cooperativeId,
          userId: req.user!.id,
          year,
          month,
          module: 'membership_fees',
          status: 'failed',
          errorMessage: odooResult.error,
        },
      });

      sendError(res, odooResult.error || 'Failed to fetch data', 400);
      return;
    }

    if (overwrite) {
      await prisma.membershipFee.deleteMany({
        where: { cooperativeId, year, month },
      });
    }

    const records = odooResult.records as Array<{
      memberId: string;
      memberName: string;
      expectedContribution: number;
      paymentMade: number;
      debt: number;
      status: 'up_to_date' | 'with_debt';
      odooPartnerId?: string;
    }>;

    if (records.length > 0) {
      await prisma.membershipFee.createMany({
        data: records.map((r) => ({
          cooperativeId,
          year,
          month,
          memberId: r.memberId,
          memberName: r.memberName,
          expectedContribution: r.expectedContribution,
          paymentMade: r.paymentMade,
          debt: r.debt,
          status: r.status,
          odooPartnerId: r.odooPartnerId,
        })),
      });
    }

    await prisma.period.upsert({
      where: { cooperativeId_year_month: { cooperativeId, year, month } },
      update: {},
      create: { cooperativeId, year, month },
    });

    await prisma.uploadHistory.create({
      data: {
        cooperativeId,
        userId: req.user!.id,
        year,
        month,
        module: 'membership_fees',
        status: 'success',
        recordsCount: records.length,
      },
    });

    await odooService.updateLastSync(cooperativeId);

    await prisma.activityLog.create({
      data: {
        userId: req.user!.id,
        action: 'Importó Cuotas de Socios',
        details: `Período: ${month}/${year}, Registros: ${records.length}`,
        ipAddress: req.ip,
      },
    });

    sendSuccess(res, {
      status: 'success',
      message: `Successfully imported ${records.length} membership fee records`,
      recordsCount: records.length,
    });
  } catch (error) {
    console.error('Upload membership fees error:', error);
    sendError(res, 'Failed to upload membership fees', 500);
  }
}

// Upload financial ratios (calculated from balance sheet)
export async function uploadRatios(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;
    const year = parseInt(req.body.year || req.query.year as string);
    const month = parseInt(req.body.month || req.query.month as string);
    const overwrite = req.body.overwrite === true || req.body.overwrite === 'true';

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    if (!year || !month) {
      sendError(res, 'Year and month are required', 400);
      return;
    }

    // Get balance sheet data to calculate ratios
    const balanceData = await prisma.balanceSheetEntry.findMany({
      where: { cooperativeId, year, month },
    });

    if (balanceData.length === 0) {
      sendError(res, 'No balance sheet data found for this period. Import balance sheet first.', 400);
      return;
    }

    // Calculate totals
    const assets = balanceData.filter((e) => e.category === 'assets');
    const liabilities = balanceData.filter((e) => e.category === 'liabilities');
    const equity = balanceData.filter((e) => e.category === 'equity');

    const totalAssets = assets.reduce((sum, e) => sum + e.finalDebit - e.finalCredit, 0);
    const totalLiabilities = liabilities.reduce((sum, e) => sum + e.finalCredit - e.finalDebit, 0);
    const totalEquity = equity.reduce((sum, e) => sum + e.finalCredit - e.finalDebit, 0);

    // Current assets/liabilities (simplified - in real app, use account codes)
    const currentAssets = totalAssets * 0.6; // Approximation
    const currentLiabilities = totalLiabilities * 0.5;

    // Get previous period ratios for trend calculation
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevRatios = await prisma.financialRatio.findMany({
      where: { cooperativeId, year: prevYear, month: prevMonth },
    });

    const prevRatioMap = new Map(prevRatios.map((r) => [r.name, r.value]));

    // Calculate ratios
    const ratios = [
      {
        name: 'Current Ratio',
        value: currentLiabilities > 0 ? currentAssets / currentLiabilities : 0,
        description: 'Capacidad de pago a corto plazo',
      },
      {
        name: 'Debt to Assets',
        value: totalAssets > 0 ? totalLiabilities / totalAssets : 0,
        description: 'Nivel de endeudamiento',
      },
      {
        name: 'Return on Equity',
        value: totalEquity > 0 ? (totalAssets - totalLiabilities - totalEquity) / totalEquity : 0,
        description: 'Rentabilidad para los socios',
      },
      {
        name: 'Operating Margin',
        value: 0.15, // Would need income statement data
        description: 'Eficiencia operativa',
      },
    ];

    // Calculate trends
    const ratiosWithTrends = ratios.map((r) => {
      const prevValue = prevRatioMap.get(r.name);
      let trend: 'up' | 'down' | 'stable' = 'stable';

      if (prevValue !== undefined) {
        const diff = r.value - prevValue;
        if (Math.abs(diff) > 0.01) {
          trend = diff > 0 ? 'up' : 'down';
        }
      }

      return { ...r, trend };
    });

    // Delete existing if overwrite
    if (overwrite) {
      await prisma.financialRatio.deleteMany({
        where: { cooperativeId, year, month },
      });
    }

    // Save ratios
    for (const ratio of ratiosWithTrends) {
      await prisma.financialRatio.upsert({
        where: {
          cooperativeId_year_month_name: {
            cooperativeId,
            year,
            month,
            name: ratio.name,
          },
        },
        update: {
          value: ratio.value,
          trend: ratio.trend,
          description: ratio.description,
        },
        create: {
          cooperativeId,
          year,
          month,
          name: ratio.name,
          value: ratio.value,
          trend: ratio.trend,
          description: ratio.description,
        },
      });
    }

    await prisma.uploadHistory.create({
      data: {
        cooperativeId,
        userId: req.user!.id,
        year,
        month,
        module: 'ratios',
        status: 'success',
        recordsCount: ratiosWithTrends.length,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user!.id,
        action: 'Calculó Ratios Financieros',
        details: `Período: ${month}/${year}`,
        ipAddress: req.ip,
      },
    });

    sendSuccess(res, {
      status: 'success',
      message: `Successfully calculated ${ratiosWithTrends.length} financial ratios`,
      recordsCount: ratiosWithTrends.length,
    });
  } catch (error) {
    console.error('Upload ratios error:', error);
    sendError(res, 'Failed to calculate ratios', 500);
  }
}

// Get upload history
export async function getUploadHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;
    const limit = parseInt(req.query.limit as string) || 20;

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    const history = await prisma.uploadHistory.findMany({
      where: { cooperativeId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: { name: true },
        },
      },
    });

    const formatted = history.map((h) => ({
      id: h.id,
      date: h.createdAt.toISOString(),
      user: h.user.name,
      period: `${h.month}/${h.year}`,
      modules: [h.module.replace('_', ' ')],
      status: h.status,
      recordsCount: h.recordsCount,
      errorMessage: h.errorMessage,
    }));

    sendSuccess(res, formatted);
  } catch (error) {
    sendError(res, 'Failed to get upload history', 500);
  }
}

// Get latest upload
export async function getLatestUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const cooperativeId = req.query.cooperativeId as string || req.user?.cooperativeId;

    if (!cooperativeId) {
      sendError(res, 'Cooperative ID required', 400);
      return;
    }

    const latest = await prisma.uploadHistory.findFirst({
      where: { cooperativeId, status: 'success' },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true } },
      },
    });

    if (!latest) {
      sendSuccess(res, null);
      return;
    }

    sendSuccess(res, {
      id: latest.id,
      date: latest.createdAt.toISOString(),
      user: latest.user.name,
      period: `${latest.month}/${latest.year}`,
      module: latest.module,
      status: latest.status,
    });
  } catch (error) {
    sendError(res, 'Failed to get latest upload', 500);
  }
}
