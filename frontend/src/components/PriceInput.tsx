type PriceInputProps = {
  amount: string;
  onAmountChange: (value: string) => void;
  priceType?: string;
};

export function PriceInput({ amount, onAmountChange, priceType = "fixed" }: PriceInputProps) {
  return (
    <>
      <label>
        Price Amount
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
        />
      </label>

      <label>
        Price Type
        <input value={priceType} disabled />
      </label>
    </>
  );
}

