import { StoreNavTabs } from "../components/StoreNavTabs";
import { SnsEditor } from "../../os/sns/SnsEditor";
export default function Page() { return <main className="sns-page"><StoreNavTabs active="sns"/><SnsEditor surface="store"/></main>; }
