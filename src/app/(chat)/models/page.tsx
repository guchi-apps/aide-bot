import { redirect } from "next/navigation";

import { ModelSettings } from "@/components/models/model-settings";
import { getCurrentUser } from "@/lib/auth-user";
import { modelSettingsFor } from "@/lib/chat-model-server";

export const metadata = { title: "モデル" };

// 選んだモデルは保存の直後に反映されるので、キャッシュさせない。
export const dynamic = "force-dynamic";

/** 用途ごとに使うAIモデルを選ぶ画面（#349）。設定とは独立している。 */
export default async function ModelsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-7">
        <ModelSettings initial={await modelSettingsFor(user.id)} />
      </div>
    </div>
  );
}
