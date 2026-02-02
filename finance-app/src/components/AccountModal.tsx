import type { Transaction } from "@/types/transaction";

interface AccountModalProps {
  name: string;
  value: string;
  transactions: Transaction[];
  loading?: boolean;
  onClose: () => void;
}

const AccountModal: React.FC<AccountModalProps> = ({
  name,
  value,
  transactions,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-100 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold mb-4">
          {name} Transactions
        </h2>

        {/* Transactions */}
        <div className="space-y-2 mb-6">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex justify-between border-b pb-1 text-sm"
            >
              <div>
                <div className="font-medium">{tx.merchant}</div>
                <div className="text-gray-500 text-xs">
                  {tx.category} • {tx.date}
                </div>
              </div>
              <span className="font-semibold">
                ${tx.amount.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="flex justify-between items-center mb-4">
          <div className="font-bold">Total Transactions:</div>
          <div className="text-lg font-semibold">
            {value}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button className="px-4 py-2 rounded bg-gray-200">
            Edit
          </button>
          <button className="px-4 py-2 rounded bg-red-500 text-white">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountModal;