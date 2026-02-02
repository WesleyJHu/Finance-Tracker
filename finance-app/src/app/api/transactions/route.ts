import { NextResponse } from "next/server";
import type { Transaction } from "@/types/transaction";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const account = searchParams.get("account");
  const month = searchParams.get("month"); // YYYY-MM

  // TEMP: fake data
    const fakeTransactions = [
        {
            id: "tx_001",
            date: "2026-01-02",
            merchant: "Trader Joe's",
            category: "Groceries",
            amount: 86.42,
            accountId: "Checking",
        },
        {
            id: "tx_002",
            date: "2026-01-03",
            merchant: "Shell",
            category: "Gas",
            amount: 47.18,
            accountId: "Checking",
        },
        {
            id: "tx_003",
            date: "2026-01-04",
            merchant: "Starbucks",
            category: "Dining",
            amount: 6.75,
            accountId: "Checking",
        },
        {
            id: "tx_004",
            date: "2026-01-05",
            merchant: "Amazon",
            category: "Shopping",
            amount: 129.99,
            accountId: "Credit",
        },
        {
            id: "tx_005",
            date: "2026-01-06",
            merchant: "Whole Foods",
            category: "Groceries",
            amount: 112.34,
            accountId: "Checking",
        },
        {
            id: "tx_006",
            date: "2026-01-07",
            merchant: "Netflix",
            category: "Subscriptions",
            amount: 15.99,
            accountId: "Credit",
        },
        {
            id: "tx_007",
            date: "2026-01-08",
            merchant: "Uber",
            category: "Transport",
            amount: 23.40,
            accountId: "Credit",
        },
        {
            id: "tx_008",
            date: "2026-01-09",
            merchant: "Chipotle",
            category: "Dining",
            amount: 18.62,
            accountId: "Checking",
        },
        {
            id: "tx_009",
            date: "2026-01-10",
            merchant: "Costco",
            category: "Groceries",
            amount: 246.81,
            accountId: "Credit",
        },
        {
            id: "tx_010",
            date: "2026-01-11",
            merchant: "Apple",
            category: "Tech",
            amount: 9.99,
            accountId: "Credit",
        },
        {
            id: "tx_011",
            date: "2026-01-12",
            merchant: "Target",
            category: "Shopping",
            amount: 54.23,
            accountId: "Checking",
        },
        {
            id: "tx_012",
            date: "2026-01-13",
            merchant: "Spotify",
            category: "Subscriptions",
            amount: 10.99,
            accountId: "Credit",
        },
        {
            id: "tx_013",
            date: "2026-01-14",
            merchant: "CVS Pharmacy",
            category: "Health",
            amount: 28.67,
            accountId: "Checking",
        },
        {
            id: "tx_014",
            date: "2026-01-15",
            merchant: "Home Depot",
            category: "Home",
            amount: 92.15,
            accountId: "Credit",
        },
        {
            id: "tx_015",
            date: "2026-01-16",
            merchant: "McDonald's",
            category: "Dining",
            amount: 11.48,
            accountId: "Checking",
        },
        {
            id: "tx_016",
            date: "2026-01-17",
            merchant: "REI",
            category: "Shopping",
            amount: 184.72,
            accountId: "Credit",
        },
        {
            id: "tx_017",
            date: "2026-01-18",
            merchant: "Electric Company",
            category: "Utilities",
            amount: 132.06,
            accountId: "Checking",
        },
        {
            id: "tx_018",
            date: "2026-01-19",
            merchant: "Water Utility",
            category: "Utilities",
            amount: 48.91,
            accountId: "Checking",
        },
        {
            id: "tx_019",
            date: "2026-01-20",
            merchant: "Airbnb",
            category: "Travel",
            amount: 312.44,
            accountId: "Credit",
        },
        {
            id: "tx_020",
            date: "2026-01-21",
            merchant: "Local Coffee Shop",
            category: "Dining",
            amount: 5.25,
            accountId: "Checking",
        },
    ];

  return NextResponse.json(fakeTransactions);
}
