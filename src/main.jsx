import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import { requestPersistentStorage } from "./db";
import "./index.css";

requestPersistentStorage();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
