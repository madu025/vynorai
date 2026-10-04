import { JSONContent } from "@tiptap/react";
import { useRef, useState } from "react";
import { getLocalStorage, setLocalStorage } from "../util/localStorage";
import useUpdatingRef from "./useUpdatingRef";

const emptyJsonContent = () => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
});

const MAX_HISTORY_LENGTH = 100;

export function useInputHistory(historyKey: string) {
  const [inputHistory, setInputHistory] = useState<JSONContent[]>(
    getLocalStorage(`inputHistory_${historyKey}`)?.slice(-MAX_HISTORY_LENGTH) ??
      [],
  );
  const [pendingInput, setPendingInput] =
    useState<JSONContent>(emptyJsonContent());
  const [currentIndex, setCurrentIndex] = useState(inputHistory.length);
  // Draft recovery: a non-empty draft that was cleared without being sent
  // comes back with ArrowUp on the empty input (once).
  const lastDraft = useRef<JSONContent | null>(null);
  const discardedDraft = useRef<JSONContent | null>(null);

  function noteContent(content: JSONContent, isEmpty: boolean) {
    if (!isEmpty) {
      lastDraft.current = content;
      discardedDraft.current = null;
    } else if (lastDraft.current) {
      discardedDraft.current = lastDraft.current;
      lastDraft.current = null;
    }
  }

  function prev(currentInput: JSONContent, isEmpty = false) {
    if (isEmpty && discardedDraft.current) {
      const draft = discardedDraft.current;
      discardedDraft.current = null;
      return draft;
    }
    let index = currentIndex;

    if (index === inputHistory.length) {
      setPendingInput(currentInput);
    }

    if (index > 0 && index <= inputHistory.length) {
      setCurrentIndex((prevState) => prevState - 1);
      return inputHistory[index - 1];
    }
  }

  function next() {
    let index = currentIndex;
    if (index >= 0 && index < inputHistory.length) {
      setCurrentIndex((prevState) => prevState + 1);
      if (index === inputHistory.length - 1) {
        return pendingInput;
      }
      return inputHistory[index + 1];
    }
  }

  function add(inputValue: JSONContent) {
    setPendingInput(emptyJsonContent());
    // A sent message is not a discarded draft.
    lastDraft.current = null;
    discardedDraft.current = null;

    if (
      JSON.stringify(inputHistory[inputHistory.length - 1]) ===
      JSON.stringify(inputValue)
    ) {
      setCurrentIndex(inputHistory.length);
      return;
    }

    setCurrentIndex(Math.min(inputHistory.length + 1, MAX_HISTORY_LENGTH));
    setInputHistory((prev) => {
      return [...prev, inputValue].slice(-MAX_HISTORY_LENGTH);
    });
    setLocalStorage(
      `inputHistory_${historyKey}`,
      [...inputHistory, inputValue].slice(-MAX_HISTORY_LENGTH),
    );
  }

  const prevRef = useUpdatingRef(prev, [inputHistory]);
  const nextRef = useUpdatingRef(next, [inputHistory]);
  const addRef = useUpdatingRef(add, [inputHistory]);
  const noteContentRef = useUpdatingRef(noteContent, []);

  return { prevRef, nextRef, addRef, noteContentRef };
}
