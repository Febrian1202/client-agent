import { app } from './app';
import { config } from '@client-agent/config';

app.listen(config.PORT, () => {
  console.log(`🦊 Elysia API is running at http://localhost:${config.PORT}`);
});
