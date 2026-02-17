import express from "express";
import cors from "cors";
import healthRoutes from "./routes/healthRoutes";
import catalogRoutes from "./routes/catalogRoutes";
import authRoutes from "./routes/authRoutes";
import searchRoutes from "./routes/searchRoutes";
import meRoutes from "./routes/meRoutes";
import contactAccessRoutes from "./routes/contactAccessRoutes";
import listingsRoutes from "./routes/listingsRoutes";
import { requestId } from "./middleware/requestId";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json());
app.use(cors());
app.use(requestId);

app.use(healthRoutes);
app.use(catalogRoutes);
app.use(authRoutes);
app.use(searchRoutes);
app.use(meRoutes);
app.use(contactAccessRoutes);
app.use(listingsRoutes);

app.use(errorHandler);

export { app };
