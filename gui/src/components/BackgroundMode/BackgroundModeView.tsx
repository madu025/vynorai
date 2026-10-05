import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { AgentsList } from "./AgentsList";

interface BackgroundModeViewProps {
  isCreatingAgent?: boolean;
}

export function BackgroundModeView({
  isCreatingAgent = false,
}: BackgroundModeViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="px-2">
        <div className="text-description text-sm">
          Send the prompt below to upload a filtered, encrypted project copy.
          Work runs in an isolated cloud sandbox and returns reviewable changes
          with a Proof Pack.
        </div>
        {isCreatingAgent && (
          <div className="text-description-muted mt-2 flex items-center gap-2 text-xs">
            <ArrowPathIcon className="h-3 w-3 animate-spin" />
            <span>Creating task...</span>
          </div>
        )}
      </div>
      <AgentsList isCreatingAgent={isCreatingAgent} />
    </div>
  );
}
