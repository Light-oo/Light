import { Router } from 'express';
import { signIn, signOut, signUp } from '../controllers/authController';

const router = Router();

router.post('/signup', signUp);
router.post('/signin', signIn);
router.post('/signout', signOut);

export default router;
