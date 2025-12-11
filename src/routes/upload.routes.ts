import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';
import {
  uploadBalanceSheet,
  uploadCashFlow,
  uploadMembershipFees,
  uploadRatios,
  getUploadHistory,
  getLatestUpload,
} from '../controllers/upload.controller.js';

const router = Router();

// All routes require authentication and admin access
router.use(authenticate);
router.use(requireAdmin);

// Upload endpoints (fetch from Odoo)
router.post('/balance-sheet', uploadBalanceSheet);
router.post('/cash-flow', uploadCashFlow);
router.post('/membership-fees', uploadMembershipFees);
router.post('/ratios', uploadRatios);

// History
router.get('/history', getUploadHistory);
router.get('/latest', getLatestUpload);

export default router;
