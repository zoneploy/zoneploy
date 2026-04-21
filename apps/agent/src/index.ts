import { createStandaloneStatus } from "./status";

const status = createStandaloneStatus();

console.log(JSON.stringify(status, null, 2));
