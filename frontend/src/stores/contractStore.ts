import { create } from 'zustand'
import type { RentalContract } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface ContractState {
  rows: RentalContract[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: RentalContract) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const contractStore = create<ContractState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<RentalContract>(db.contracts)
    rows.sort((a, b) => a.rentStart.localeCompare(b.rentStart) || a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<RentalContract>(db.contracts, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<RentalContract>(db.contracts, id)
    await get().hydrate()
  }
}))
