import { SparklesIcon } from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";

/**
 * VynorAI owns model routing. End users should see the active product mode,
 * not provider credentials or the internal model selected for a request.
 */
function ModelSelect() {
  const isConfigLoading = useAppSelector((state) => state.config.loading);

  return (
    <div
      data-testid="model-select-button"
      className="text-description flex h-[18px] items-center gap-1 text-xs"
      title="VynorAI automatically selects the best model for each request"
    >
      <SparklesIcon className="h-3 w-3 flex-shrink-0" />
      <span>{isConfigLoading ? "VynorAI loading" : "VynorAI Auto"}</span>
    </div>
  );
}

export default ModelSelect;
