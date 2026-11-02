import { useEffect, useState } from "react";
import { Landing } from "./pages/Landing";
import { Onboarding } from "./pages/Onboarding";
import { Workspace } from "./pages/Workspace";
import { OperatorGate } from "./pages/OperatorGate";

const route = () => location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];

export default function Root() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const on = () => { setR(route()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  if (r === "start") return <Onboarding />;
  if (r === "app") return <Workspace />;
  if (r === "operator") return <OperatorGate />;
  return <Landing />;
}
