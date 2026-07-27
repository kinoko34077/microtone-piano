import React, {useEffect, useState} from 'react';

interface BlurCommitNumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number | string;
}

export const BlurCommitNumberInput: React.FC<BlurCommitNumberInputProps> = ({
  value,
  onCommit,
  className,
  min,
  max,
  step,
}) => {
  const [draft, setDraft] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(value));
    }
  }, [isFocused, value]);

  const commitValue = () => {
    let nextValue = draft.trim() === '' ? value : Number(draft);
    if (Number.isNaN(nextValue)) {
      nextValue = value;
    }
    if (min !== undefined) {
      nextValue = Math.max(min, nextValue);
    }
    if (max !== undefined) {
      nextValue = Math.min(max, nextValue);
    }
    onCommit(nextValue);
    setDraft(String(nextValue));
    setIsFocused(false);
  };

  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitValue}
      className={className}
    />
  );
};
