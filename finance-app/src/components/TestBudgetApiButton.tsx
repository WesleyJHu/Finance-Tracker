"use client"

export default function TestApiPanel() {

    // GET
    const testGET = async () => {
        const res = await fetch("/api/monthly_budgets?month=4")
        const data = await res.json()

        console.log("GET result:", data)
    }

    // PATCH
    const testPATCH = async () =>  {
        const res = await fetch("/api/monthly_budgets", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                month: 4,
                base_budget: 2000
            })
        })

        const data = await res.json()
        console.log("PATCH result:", data)
    }

    return (
        <div className="flex gap-3 mb-4">

            <button
                onClick={testGET}
                className="px-3 py-1 bg-blue-500 text-white rounded"
            >
                Test Budget GET
            </button>

            <button
                onClick={testPATCH}
                className="px-3 py-1 bg-green-500 text-white rounded"
            >
                Test Budget PATCH
            </button>

        </div>
    )
}