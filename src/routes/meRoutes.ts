import { Router } from 'express';
import { getMe } from '../controllers/authController';

const router = Router();

router.get('/me', getMe);

export default router;
