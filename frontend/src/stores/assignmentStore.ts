import { create } from 'zustand'
import type { ContractAssignment } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface AssignmentState {
  rows: ContractAssignment[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: ContractAssignment) => Promise<void>
  bulkSave: (rows: ContractAssignment[]) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByContract: (contractId: string) => Promise<void>
}

export const assignmentStore = create<AssignmentState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<ContractAssignment>(db.assignments)
    rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.contractId.localeCompare(b.contractId))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<ContractAssignment>(db.assignments, row)
    await get().hydrate()
  },
  bulkSave: async (rows) => {
    await db.assignments.bulkPut(rows)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<ContractAssignment>(db.assignments, id)
    await get().hydrate()
  },
  // 删除合同时连带清理其投放排期
  removeByContract: async (contractId) => {
    const targets = get().rows.filter((row) => row.contractId === contractId)
    await Promise.all(targets.map((row) => deleteRow<ContractAssignment>(db.assignments, row.id)))
    await get().hydrate()
  }
}))
