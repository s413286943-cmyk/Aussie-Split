import { redirect } from "next/navigation";

// Settlement between two couples was removed; keep old bookmarks working.
export default function SettlementPage() {
  redirect("/summary");
}
