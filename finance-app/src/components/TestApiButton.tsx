"use client"

export default function TestApiButton() {

  const testAPI = async () => {
    const res = await fetch("/api/transactions?month=3&year=2026")
    const data = await res.json()

    console.log(data)
  }

  return (
    <button
      onClick={testAPI}
      className="bg-blue-500 text-white px-3 py-1 rounded mb-4"
    >
      Test API
    </button>
  )
}