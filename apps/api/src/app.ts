import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';

export const app = new Elysia()
  .use(
    cors({
      origin: true,
      credentials: true,
    })
  )
  .use(healthRoutes)
  .use(authRoutes);
