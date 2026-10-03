import { OsNavList, canonicalNavItems } from "../components/OsNavList";
import { SnsEditor } from "./SnsEditor";
export default function Page() { return <main className="sns-page"><nav aria-label="OS"><OsNavList navItems={canonicalNavItems}/></nav><SnsEditor surface="os"/></main>; }
