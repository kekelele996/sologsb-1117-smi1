/**
 * 租蜂合同与投放排单
 *
 * 角色约定（数据各自一段，互不覆盖）：
 * - 蜂场技术员：登记合同（箱数、起租日、归租日、单价、邻县蜂场），登记实际归还；
 * - 托管队：只读费用预估，合同/归还字段在托管队视图下不可编辑。
 * 投放排单（RentalPlacement）由技术员执行，按合同箱数补地块缺口。
 */

/** RentalContract 租蜂合同（与邻县蜂场签订） */
export interface RentalContract {
  id: string
  /** 合同编号，如 ZL-2026-01 */
  code: string
  /** 邻县蜂场名称 */
  apiaryName: string
  /** 联系人/电话 */
  contact: string
  /** 合同箱数（总箱数） */
  boxCount: number
  /** 起租日 YYYY-MM-DD */
  rentStart: string
  /** 归租日（约定归还日）YYYY-MM-DD */
  rentEnd: string
  /** 合同单价：元 / 箱 / 天（租金、超期、缺箱赔偿统一按此单价折算） */
  unitPrice: number
  /** 合同备注 */
  note: string
  /** 实际归还日期（到期前登记；未登记表示尚未归还） */
  actualReturnDate: string
  /** 实际归还箱数（未登记为空） */
  actualReturnBoxes: number | null
}

/** RentalPlacement 租蜂投放排单：某份合同在某段时间投放到某地块补缺口 */
export interface RentalPlacement {
  id: string
  /** 租蜂合同 id */
  contractId: string
  /** 投放地块 id */
  orchardId: string
  /** 投放箱数（不得超过合同箱数） */
  boxCount: number
  /** 投放开始日（须落在合同起租~归租区间内） */
  startDate: string
  /** 投放结束日（须落在合同起租~归租区间内） */
  endDate: string
}

/** 合同状态 */
export type ContractStatus = '在租' | '已到期未还' | '已归还' | '未起租'

/** 费用拆分（单位：元，保留 2 位） */
export interface ContractFee {
  /** 合同在租总天数（起租日~归租日，含首尾） */
  rentDays: number
  /** 基础租金 = 合同箱数 × 在租天数 × 单价 */
  baseFee: number
  /** 超期天数（实际归还日晚于归租日，含归还当天） */
  overdueDays: number
  /** 超期费用 = 合同箱数 × 超期天数 × 单价 */
  overdueFee: number
  /** 缺箱数 = 合同箱数 − 实际归还箱数 */
  missingBoxes: number
  /** 缺箱赔偿 = 缺箱数 × 在租天数 × 单价 */
  missingFee: number
  /** 预估合计 */
  totalFee: number
  /** 是否已登记实际归还 */
  settled: boolean
}

/** 两个日期区间是否按天重叠（含首尾，与花期重叠口径一致） */
export function dateRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA
}

/** 含首尾的天数（b − a + 1），非法日期返回 0 */
export function inclusiveDays(start: string, end: string): number {
  if (!start || !end || start > end) return 0
  const a = new Date(`${start}T00:00:00Z`).getTime()
  const b = new Date(`${end}T00:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86400000) + 1
}

/** 合同状态判定 */
export function contractStatus(contract: RentalContract, today = new Date().toISOString().slice(0, 10)): ContractStatus {
  if (contract.actualReturnDate) return '已归还'
  if (today < contract.rentStart) return '未起租'
  if (today > contract.rentEnd) return '已到期未还'
  return '在租'
}

/**
 * 费用预估（纯派生，托管队只读）：
 * - 未登记归还：按当前日期估算——未超期时仅基础租金，已超期叠加「合同箱数 × 已超期天数」；
 * - 已登记归还：基础租金 + 超期费（实际归还日 − 归租日，含当天）+ 缺箱赔偿（按整个在租期折算）。
 */
export function estimateFee(
  contract: RentalContract,
  today = new Date().toISOString().slice(0, 10)
): ContractFee {
  const rentDays = inclusiveDays(contract.rentStart, contract.rentEnd)
  const price = contract.unitPrice > 0 ? contract.unitPrice : 0
  const baseFee = round2(contract.boxCount * rentDays * price)

  let overdueDays = 0
  let missingBoxes = 0
  const settled = Boolean(contract.actualReturnDate)

  if (settled) {
    if (contract.actualReturnDate > contract.rentEnd) {
      overdueDays = inclusiveDays(dayAfter(contract.rentEnd), contract.actualReturnDate)
    }
    const returned = contract.actualReturnBoxes ?? 0
    missingBoxes = Math.max(0, contract.boxCount - returned)
  } else if (today > contract.rentEnd) {
    overdueDays = inclusiveDays(dayAfter(contract.rentEnd), today)
  }

  const overdueFee = round2(contract.boxCount * overdueDays * price)
  const missingFee = round2(missingBoxes * rentDays * price)
  return {
    rentDays,
    baseFee,
    overdueDays,
    overdueFee,
    missingBoxes,
    missingFee,
    totalFee: round2(baseFee + overdueFee + missingFee),
    settled
  }
}

/** 归租日次日（超期从这一天算起，含实际归还当天） */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
