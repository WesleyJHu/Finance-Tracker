export interface CardProps {
  id: string;
  name: string;
  type: string;
  limit: number;
  value: number;
  size?: number;
  strokeWidth?: number;
  onUpdate?: (account: { id: string; name: string; type: string; balance: number; max?: number }) => void;
  onDelete?: (id: string) => void;
}