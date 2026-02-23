import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Listening on :${env.PORT}`);
});
