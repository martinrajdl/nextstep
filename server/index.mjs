import { startServer } from './http.mjs';
const service = await startServer({developmentOrigins:['http://localhost:4317','http://127.0.0.1:4317']});
console.log(`Nextstep running at ${service.url}\nDatabase: ${service.database}`);
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,() => { service.close().then(() => process.exit(0)); });
