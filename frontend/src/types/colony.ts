/** 蜂种 */
export const BEE_SPECIES = ['意蜂', '中蜂'] as const
export type BeeSpecies = (typeof BEE_SPECIES)[number]

/** 蜂群状态 */
export const COLONY_STATUSES = ['待投放', '在园', '转场中', '回场'] as const
export type ColonyStatus = (typeof COLONY_STATUSES)[number]

/** 箱型 */
export const BOX_TYPES = ['标准继箱', '平箱', '交尾箱'] as const
export type BoxType = (typeof BOX_TYPES)[number]

/** 蜂群来源：自有群 / 从邻县蜂场租入 */
export const COLONY_SOURCES = ['自有', '租入'] as const
export type ColonySource = (typeof COLONY_SOURCES)[number]

/** BeeColony 蜂群 */
export interface BeeColony {
  id: string
  /** 群号 */
  code: string
  species: BeeSpecies
  /** 群势（足框数） */
  strengthFrames: number
  boxType: BoxType
  /** 当前所在地块 */
  currentOrchardId: string
  status: ColonyStatus
  /** 最近检查日期 */
  lastCheckDate: string
  /** 蜂群健康备注 */
  healthNote: string
  /** 来源：自有 / 租入（v3 升级，历史数据按自有补齐） */
  source: ColonySource
  /** 租入时关联的租蜂合同 id，自有群为空 */
  contractId?: string
}
