"use client"

export default function TestApiPanel() {

  // GET
  const testGET = async () => {
    const res = await fetch("/api/accounts")
    const data = await res.json()

    console.log("GET result:", data)
  }

  // POST
  const testPOST = async () => {
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "Test Account",
        type: "Checking",
        balance: 1000
      })
    })

    const data = await res.json()
    console.log("POST result:", data)
  }

  // PATCH
  const testPATCH = async () => {
    const res = await fetch("/api/accounts", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "33299685-89a2-44dc-9fb3-4cedc911d971",
        name: "New Account",
        balance: 40
      })
    })

    const data = await res.json()
    console.log("PATCH result:", data)
  }

  // DELETE
  const testDELETE = async () => {
    const res = await fetch("/api/accounts", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: "33299685-89a2-44dc-9fb3-4cedc911d971"
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
        Test GET
      </button>

      <button
        onClick={testPOST}
        className="bg-green-500 text-white px-3 py-1 rounded"
      >
        Test POST
      </button>

      <button
        onClick={testPATCH}
        className="bg-yellow-500 text-white px-3 py-1 rounded"
      >
        Test PATCH
      </button>

      <button
        onClick={testDELETE}
        className="bg-red-500 text-white px-3 py-1 rounded"
      >
        Test DELETE
      </button>

    </div>
  )
}