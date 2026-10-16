import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { assertEnv, env } from './config/env';

const SUCCESS_CODE = 0;
const FAILURE_CODE = 1;

async function main(): Promise<void> {
  assertEnv(); // fail fast if config is missing
  await connectDatabase(env.mongodbUri);

  const server = createApp().listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        void disconnectDatabase().finally(() => process.exit(SUCCESS_CODE));
      });
    });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(FAILURE_CODE);
});
