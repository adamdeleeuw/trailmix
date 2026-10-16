import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { assertEnv, env } from './config/env';

const FAILURE_CODE = 1;

async function main(): Promise<void> {
  assertEnv(); // fail fast if config is missing
  await connectDatabase(env.mongodbUri);

  const server = createApp().listen(env.port, () => {
    console.log(`Server listening on port ${env.port}`);
  });

  // once the server and database are closed nothing keeps the event loop alive, so node exits on its own
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        disconnectDatabase().catch((err: unknown) => {
          console.error(err);
          process.exitCode = FAILURE_CODE;
        });
      });
    });
  }
}

main().catch(async (err: unknown) => {
  console.error(err);
  process.exitCode = FAILURE_CODE;
  await disconnectDatabase(); // startup may have failed after connecting, which would keep node alive
});
