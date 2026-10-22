import App from "./App";
import SecondTabNotice from "./components/SecondTabNotice";
import useSingleTab from "./useSingleTab";

/**
 * The app runs in one tab at a time. A second tab gets a notice and a
 * button; App itself is never mounted there, so no autosave timer, no sync
 * timer and no half-loaded story ever exist in it.
 */
export default function Root() {
  const tab = useSingleTab();
  if (tab.status === "blocked") {
    return <SecondTabNotice onTakeOver={tab.takeOver} />;
  }
  if (tab.status === "checking") return null;
  return <App />;
}
