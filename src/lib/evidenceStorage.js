const DATABASE_NAME = 'alevel-paper-evidence-v1'
const STORE_NAME = 'images'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transact(mode, action) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = action(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => reject(transaction.error)
  }))
}

export function putPaperEvidence(record) {
  return transact('readwrite', (store) => store.put(record))
}

export function getPaperEvidence(id) {
  return transact('readonly', (store) => store.get(id))
}

export function deletePaperEvidence(id) {
  return transact('readwrite', (store) => store.delete(id))
}
