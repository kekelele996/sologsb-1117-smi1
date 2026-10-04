import { create } from 'zustand'
import type { RentalContract } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface RentalContractState {
  rows: RentalContract[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: RentalContract) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 技术员登记实际归还（只改归还段，不动合同条款与投放排单） */
  registerReturn: (id: string, actualReturnDate: string, actualReturnBoxes: number) => Promise<void>
}

export const rentalContractStore = create<RentalContractState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<RentalContract>(db.rentalContracts)
    rows.sort((a, b) => b.rentStart.localeCompare(a.rentStart))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<RentalContract>(db.rentalContracts, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<RentalContract>(db.rentalContracts, id)
    await get().hydrate()
  },
  registerReturn: async (id, actualReturnDate, actualReturnBoxes) => {
    const current = get().rows.find((row) => row.id === id)
    if (!current) return
    await putRow<RentalContract>(db.rentalContracts, {
      ...current,
      actualReturnDate,
      actualReturnBoxes: Math.max(0, Math.min(current.boxCount, actualReturnBoxes))
    })
    await get().hydrate()
  }
}))
