"use client"

export default function TestApiPanel() {

  // GET
  const testGET = async () => {
    const res = await fetch("/api/transactions?month=3&year=2026")
    const data = await res.json()

    console.log("GET result:", data)
  }

  // POST
  const testPOST = async () => {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        description: "Test Transaction",
        amount: 25.50,
        date: "2026-03-25",
        category: "food",
        account_id: "2d9b0d2c-3c7c-4c7c-9d7c-8d5e8c4f6a11"
      })
    })

    const data = await res.json()
    console.log("POST result:", data)
  }

  // PATCH
  const testPATCH = async () => {
    const res = await fetch("/api/transactions", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "b1de860e-ef5b-4b5b-a277-d7043d22c4e6",
        description: "Updated Transaction",
        amount: 40
      })
    })

    const data = await res.json()
    console.log("PATCH result:", data)
  }

  // DELETE
  const testDELETE = async () => {
    const res = await fetch("/api/transactions", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "b1de860e-ef5b-4b5b-a277-d7043d22c4e6"
      })
    })

    const data = await res.json()
    console.log("DELETE result:", data)
  }

  return (
    <div className="flex gap-3 mb-4">
      
      <button
        onClick={testGET}
        className="bg-blue-500 text-white px-3 py-1 rounded"
      >
        Test Transaction GET
      </button>

      <button
        onClick={testPOST}
        className="bg-green-500 text-white px-3 py-1 rounded"
      >
        Test Transaction POST
      </button>

      <button
        onClick={testPATCH}
        className="bg-yellow-500 text-white px-3 py-1 rounded"
      >
        Test Transaction PATCH
      </button>

      <button
        onClick={testDELETE}
        className="bg-red-500 text-white px-3 py-1 rounded"
      >
        Test Transaction DELETE
      </button>

    </div>
  )
}