import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ContractAssignment, ContractFee, RentalContract } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { contractStore } from '@/stores/contractStore'
import { assignmentStore } from '@/stores/assignmentStore'
import { uid } from '@/utils/id'
import {
  checkAssignment,
  computeGapPlan,
  estimateFee,
  inclusiveDays,
  isWithin,
  planRentalFill
} from '@/utils/gap'

interface ContractFormValues {
  code: string
  supplier: string
  boxCount: number
  rentRange: [dayjs.Dayjs, dayjs.Dayjs]
  unitPrice: number
  contact: string
  note: string
}

interface AssignmentFormValues {
  contractId: string
  orchardId: string
  boxes: number
  range: [dayjs.Dayjs, dayjs.Dayjs]
}

interface ReturnFormValues {
  actualReturnDate: dayjs.Dayjs
  actualReturnBoxes: number
}

const LIFECYCLE_META: Record<ContractFee['lifecycle'], { label: string; color: string }> = {
  待起租: { label: '待起租', color: 'default' },
  在租: { label: '在租', color: 'blue' },
  已到期未还: { label: '已到期未还', color: 'red' },
  已归还: { label: '已归还', color: 'green' }
}

/** 租蜂合同：技术员登记合同箱数/起归租日/单价与实际归还，按合同箱数排投放补缺口 */
export default function RentalsPage(): JSX.Element {
  const contracts = usePersistentStore(contractStore, (state) => state.rows)
  const assignments = usePersistentStore(assignmentStore, (state) => state.rows)
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)

  const [contractModal, setContractModal] = useState(false)
  const [editing, setEditing] = useState<RentalContract | null>(null)
  const [contractForm] = Form.useForm<ContractFormValues>()

  const [returnModal, setReturnModal] = useState<RentalContract | null>(null)
  const [returnForm] = Form.useForm<ReturnFormValues>()

  const [assignmentModal, setAssignmentModal] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<ContractAssignment | null>(null)
  const [assignmentForm] = Form.useForm<AssignmentFormValues>()

  const today = new Date().toISOString().slice(0, 10)
  const fees = useMemo<ContractFee[]>(() => contracts.map((item) => estimateFee(item, today)), [contracts, today])

  /** 缺口重算：花期需蜂 − 固定自有 − 机动自有池 − 已排租蜂；花期/容量/排期变化后自动更新（纯派生，不入库） */
  const plan = useMemo(
    () => computeGapPlan(orchards, colonies, dropPoints, assignments, today),
    [orchards, colonies, dropPoints, assignments, today]
  )

  const activeContracts = contracts.filter((item) => isWithin(today, item.rentStart, item.rentEnd)).length
  const totalFee = fees.reduce((sum, item) => sum + item.totalFee, 0)
  const overdueCount = fees.filter((item) => item.lifecycle === '已到期未还' || item.overdueDays > 0).length

  function nameOfOrchard(id: string): string {
    return orchards.find((item) => item.id === id)?.name ?? '未知地块'
  }
  function codeOfContract(id: string): string {
    return contracts.find((item) => item.id === id)?.code ?? '未知合同'
  }

  function openCreateContract(): void {
    setEditing(null)
    contractForm.setFieldsValue({
      code: `ZL-${String(contracts.length + 1).padStart(2, '0')}`,
      supplier: '',
      boxCount: 20,
      rentRange: [dayjs().add(1, 'day'), dayjs().add(15, 'day')],
      unitPrice: 2.5,
      contact: '',
      note: ''
    })
    setContractModal(true)
  }

  function openEditContract(row: RentalContract): void {
    setEditing(row)
    contractForm.setFieldsValue({
      code: row.code,
      supplier: row.supplier,
      boxCount: row.boxCount,
      rentRange: [dayjs(row.rentStart), dayjs(row.rentEnd)],
      unitPrice: row.unitPrice,
      contact: row.contact,
      note: row.note
    })
    setContractModal(true)
  }

  async function submitContract(): Promise<void> {
    const values = await contractForm.validateFields()
    if (contracts.some((item) => item.code === values.code.trim() && item.id !== editing?.id)) {
      message.error(`合同编号 ${values.code} 已存在`)
      return
    }
    const [start, end] = values.rentRange
    const row: RentalContract = {
      id: editing?.id ?? uid('ct'),
      code: values.code.trim(),
      supplier: values.supplier.trim(),
      boxCount: Number(values.boxCount) || 0,
      rentStart: start.format('YYYY-MM-DD'),
      rentEnd: end.format('YYYY-MM-DD'),
      unitPrice: Number(values.unitPrice) || 0,
      contact: values.contact?.trim() ?? '',
      actualReturnDate: editing?.actualReturnDate ?? '',
      actualReturnBoxes: editing?.actualReturnBoxes,
      note: values.note?.trim() ?? ''
    }
    await contractStore.getState().save(row)
    message.success(`合同 ${row.code} 已保存`)
    setContractModal(false)
  }

  function openReturn(row: RentalContract): void {
    setReturnModal(row)
    returnForm.setFieldsValue({
      actualReturnDate: dayjs(row.actualReturnDate || today),
      actualReturnBoxes: row.actualReturnBoxes ?? row.boxCount
    })
  }

  async function submitReturn(): Promise<void> {
    if (!returnModal) return
    const values = await returnForm.validateFields()
    if (values.actualReturnBoxes < 0 || values.actualReturnBoxes > returnModal.boxCount) {
      message.error(`归还箱数需在 0 ~ ${returnModal.boxCount} 之间`)
      return
    }
    await contractStore.getState().save({
      ...returnModal,
      actualReturnDate: values.actualReturnDate.format('YYYY-MM-DD'),
      actualReturnBoxes: Number(values.actualReturnBoxes)
    })
    message.success('已登记实际归还，费用预估已同步重算')
    setReturnModal(null)
  }

  function openCreateAssignment(): void {
    setEditingAssignment(null)
    assignmentForm.setFieldsValue({
      contractId: contracts[0]?.id,
      orchardId: orchards[0]?.id,
      boxes: 1,
      range: orchards[0]
        ? [dayjs(orchards[0].bloomStart), dayjs(orchards[0].bloomStart)]
        : [dayjs(), dayjs()]
    })
    setAssignmentModal(true)
  }

  function openEditAssignment(row: ContractAssignment): void {
    setEditingAssignment(row)
    assignmentForm.setFieldsValue({
      contractId: row.contractId,
      orchardId: row.orchardId,
      boxes: row.boxes,
      range: [dayjs(row.startDate), dayjs(row.endDate)]
    })
    setAssignmentModal(true)
  }

  async function submitAssignment(): Promise<void> {
    const values = await assignmentForm.validateFields()
    const [start, end] = values.range
    const draft: Omit<ContractAssignment, 'id'> = {
      contractId: values.contractId,
      orchardId: values.orchardId,
      boxes: Number(values.boxes) || 0,
      startDate: start.format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD')
    }
    const conflicts = checkAssignment(draft, contracts, orchards, assignments, editingAssignment?.id)
    if (conflicts.length > 0) {
      message.error({ content: conflicts.map((item) => item.message).join('；'), duration: 6 })
      return
    }
    await assignmentStore.getState().save({ id: editingAssignment?.id ?? uid('asg'), ...draft })
    message.success('投放排期已保存，缺口与在租箱数已重算')
    setAssignmentModal(false)
  }

  async function autoFill(): Promise<void> {
    const result = planRentalFill(plan, contracts, assignments)
    if (result.additions.length === 0) {
      message.success(result.uncovered.length > 0 ? '现有合同箱数已用满，仍有缺口无法补齐' : '当前没有需要租蜂补的缺口')
      if (result.uncovered.length > 0) message.warning(`仍有 ${result.uncovered.length} 个地块-日期缺口超出可用合同箱数`)
      return
    }
    await assignmentStore.getState().bulkSave(result.additions)
    message.success(`已按合同箱数生成 ${result.additions.length} 段投放排期`)
    if (result.uncovered.length > 0) {
      message.warning(`仍有 ${result.uncovered.length} 个地块-日期缺口超出可用合同箱数`)
    }
  }

  const gapRows = plan.orchards.map((item) => ({
    key: item.orchard.id,
    orchardName: item.orchard.name,
    bloom: `${item.orchard.bloomStart} ~ ${item.orchard.bloomEnd}`,
    demand: item.demand,
    capacity: Number.isFinite(item.capacity) ? item.capacity : '不限',
    rented: item.rented,
    gap: item.gap,
    peakDate: item.peakDate,
    capacityLimited: item.capacityLimited
  }))

  const feeColumns = [
    { title: '合同编号', dataIndex: ['contract', 'code'], key: 'code', width: 100 },
    { title: '出租方', dataIndex: ['contract', 'supplier'], key: 'supplier' },
    {
      title: '箱数 / 租期',
      key: 'term',
      render: (_: unknown, row: ContractFee) => `${row.contract.boxCount} 箱｜${row.contract.rentStart} ~ ${row.contract.rentEnd}`
    },
    {
      title: '单价',
      key: 'price',
      width: 130,
      render: (_: unknown, row: ContractFee) => `${row.contract.unitPrice} 元/箱·天`
    },
    {
      title: '状态',
      key: 'lifecycle',
      width: 110,
      render: (_: unknown, row: ContractFee) => <Tag color={LIFECYCLE_META[row.lifecycle].color}>{LIFECYCLE_META[row.lifecycle].label}</Tag>
    },
    {
      title: '超期',
      key: 'overdue',
      width: 90,
      render: (_: unknown, row: ContractFee) => (row.overdueDays > 0 ? <Tag color="orange">{row.overdueDays} 天</Tag> : '—')
    },
    {
      title: '缺箱',
      key: 'missing',
      width: 80,
      render: (_: unknown, row: ContractFee) => (row.missingBoxes > 0 ? <Tag color="orange">{row.missingBoxes} 箱</Tag> : '—')
    },
    {
      title: '超期费用',
      dataIndex: 'overdueFee',
      key: 'ofee',
      width: 100,
      render: (value: number) => `¥${value.toFixed(2)}`
    },
    {
      title: '缺箱费用',
      dataIndex: 'missingFee',
      key: 'mfee',
      width: 100,
      render: (value: number) => `¥${value.toFixed(2)}`
    },
    {
      title: '费用合计',
      dataIndex: 'totalFee',
      key: 'total',
      width: 110,
      render: (value: number) => <Typography.Text strong type={value > 0 ? 'danger' : undefined}>¥{value.toFixed(2)}</Typography.Text>
    }
  ]

  const contractColumns = [
    { title: '合同编号', dataIndex: 'code', key: 'code', width: 110 },
    { title: '出租方', dataIndex: 'supplier', key: 'supplier' },
    { title: '联系方式', dataIndex: 'contact', key: 'contact', width: 170, render: (v: string) => v || '—' },
    { title: '合同箱数', dataIndex: 'boxCount', key: 'box', width: 90 },
    { title: '起租日', dataIndex: 'rentStart', key: 'start', width: 110 },
    { title: '归租日', dataIndex: 'rentEnd', key: 'end', width: 110 },
    { title: '单价(元/箱·天)', dataIndex: 'unitPrice', key: 'price', width: 120 },
    {
      title: '实际归还',
      key: 'returned',
      render: (_: unknown, row: RentalContract) =>
        row.actualReturnDate ? `${row.actualReturnDate} / ${row.actualReturnBoxes ?? '—'} 箱` : <Tag>未登记</Tag>
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_: unknown, row: RentalContract) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEditContract(row)}>编辑</Button>
          <Button size="small" type="link" onClick={() => openReturn(row)}>归还登记</Button>
          <Popconfirm
            title="删除合同将连带删除其全部投放排期"
            onConfirm={async () => {
              await assignmentStore.getState().removeByContract(row.id)
              await contractStore.getState().remove(row.id)
              message.success('合同已删除')
            }}
          >
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const assignmentColumns = [
    { title: '合同', key: 'contract', render: (_: unknown, row: ContractAssignment) => codeOfContract(row.contractId) },
    { title: '地块', key: 'orchard', render: (_: unknown, row: ContractAssignment) => nameOfOrchard(row.orchardId) },
    { title: '箱数', dataIndex: 'boxes', key: 'boxes', width: 80 },
    {
      title: '投放起止',
      key: 'range',
      render: (_: unknown, row: ContractAssignment) => `${row.startDate} ~ ${row.endDate}（${inclusiveDays(row.startDate, row.endDate)} 天）`
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, row: ContractAssignment) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEditAssignment(row)}>编辑</Button>
          <Popconfirm title="删除该投放排期？" onConfirm={() => void assignmentStore.getState().remove(row.id)}>
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">租蜂合同与缺口补位</h2>
          <p className="page-sub">
            技术员登记邻县蜂场租蜂合同（箱数 / 起租日 / 归租日 / 单价），按合同箱数排投放补自有群缺口；同一份合同同一天不能投放到两个地块。到期前登记实际归还日期与箱数，超期天数与缺箱按合同单价折费。
          </p>
        </div>
        <Space>
          <Button onClick={openCreateAssignment}>手动排投放</Button>
          <Button type="primary" onClick={() => void autoFill()}>按合同自动补缺口</Button>
          <Button type="primary" ghost onClick={openCreateContract}>新增租蜂合同</Button>
        </Space>
      </div>

      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="合同总数" value={contracts.length} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="今日在租合同" value={activeContracts} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="今日在租箱数" value={plan.rentedToday} suffix="箱" /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={<span>费用预估合计（只读）{overdueCount > 0 ? <Tag color="orange" style={{ marginLeft: 6 }}>{overdueCount} 份涉超期</Tag> : null}</span>}
              value={totalFee}
              precision={2}
              prefix="¥"
              valueStyle={{ color: totalFee > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={
          <Space>
            费用预估（托管队只读）
            <Tooltip title="超期费用 = 超期天数 × 合同箱数 × 单价；缺箱费用 =（合同箱数 − 实际归还箱数）× 单价。地块花期或容量改动只影响缺口与在租箱数，不覆盖合同与归还登记。">
              <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
            </Tooltip>
          </Space>
        }
      >
        <Table<ContractFee> dataSource={fees} rowKey={(row) => row.contract.id} size="small" pagination={false} columns={feeColumns} />
      </Card>

      <Card size="small" title={`租蜂合同台账（${contracts.length} 份）`}>
        <Table<RentalContract> dataSource={contracts} rowKey="id" size="small" pagination={false} columns={contractColumns} />
      </Card>

      <Row gutter={16}>
        <Col xs={24} xl={13}>
          <Card
            size="small"
            title="地块缺口（花期/容量改动后自动重算）"
            extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>缺口峰值合计 {plan.totalGapPeak} 箱</Typography.Text>}
          >
            {plan.totalGapPeak > 0 ? (
              <Alert
                style={{ marginBottom: 12 }}
                type="warning"
                showIcon
                message={`自有群补位后仍有 ${plan.totalGapPeak} 箱缺口峰值，可用「按合同自动补缺口」生成投放排期`}
              />
            ) : (
              <Alert style={{ marginBottom: 12 }} type="success" showIcon message="现有自有群与合同排期可覆盖全部花期需求" />
            )}
            <Table<(typeof gapRows)[number]>
              dataSource={gapRows}
              rowKey="key"
              size="small"
              pagination={false}
              columns={[
                { title: '地块', dataIndex: 'orchardName', key: 'name' },
                { title: '盛花期', dataIndex: 'bloom', key: 'bloom' },
                { title: '需蜂', dataIndex: 'demand', key: 'demand', width: 70 },
                { title: '容量', dataIndex: 'capacity', key: 'cap', width: 70 },
                { title: '已排租蜂', dataIndex: 'rented', key: 'rented', width: 90 },
                {
                  title: '缺口峰值',
                  dataIndex: 'gap',
                  key: 'gap',
                  width: 120,
                  render: (value: number, row) =>
                    value > 0 ? <Tag color="red">{value} 箱 · {row.peakDate.slice(5)}</Tag> : <Tag color="green">0</Tag>
                }
              ]}
              rowClassName={(row) => (row.capacityLimited ? 'conflict-row' : '')}
            />
            {gapRows.some((item) => item.capacityLimited) ? (
              <Typography.Paragraph type="warning" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                标红行：花期需蜂超过投放点容量，缺口按容量封顶，请先扩容投放点。
              </Typography.Paragraph>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} xl={11}>
          <Card size="small" title={`合同投放排期（${assignments.length} 段）`} extra={<Button size="small" type="link" onClick={openCreateAssignment}>+ 手动排期</Button>}>
            <Table<ContractAssignment>
              dataSource={assignments}
              rowKey="id"
              size="small"
              pagination={false}
              columns={assignmentColumns}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              自动补缺口优先安排起租日早、编号小的合同；同合同跨地块同日合计不超过合同箱数。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      <Modal title={editing ? '编辑租蜂合同' : '新增租蜂合同'} open={contractModal} onCancel={() => setContractModal(false)} onOk={() => void submitContract()} okText="保存" width={620}>
        <Form form={contractForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="合同编号" rules={[{ required: true, message: '请填写合同编号' }]}>
                <Input placeholder="如 ZL-01" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supplier" label="出租方（邻县蜂场）" rules={[{ required: true, message: '请填写出租方' }]}>
                <Input placeholder="如 陇县关山蜂场" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="boxCount" label="合同箱数" rules={[{ required: true }]}>
                <InputNumber min={1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="rentRange" label="起租日 ~ 归租日" rules={[{ required: true, message: '请选择租期' }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="unitPrice" label="单价（元/箱·天）" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="contact" label="联系方式">
                <Input placeholder="电话/联系人" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="note" label="备注">
                <Input.TextArea rows={2} placeholder="箱型、转运、押金等约定" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal title={returnModal ? `归还登记 · ${returnModal.code}` : ''} open={Boolean(returnModal)} onCancel={() => setReturnModal(null)} onOk={() => void submitReturn()} okText="登记归还" width={460}>
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message={`归租日 ${returnModal?.rentEnd ?? ''}；合同 ${returnModal?.boxCount ?? 0} 箱，单价 ${returnModal?.unitPrice ?? 0} 元/箱·天`}
        />
        <Form form={returnForm} layout="vertical">
          <Form.Item name="actualReturnDate" label="实际归还日期" rules={[{ required: true, message: '请选择实际归还日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="actualReturnBoxes" label="实际归还箱数" rules={[{ required: true, message: '请填写归还箱数' }]}>
            <InputNumber min={0} max={returnModal?.boxCount} precision={0} style={{ width: '100%' }} addonAfter="箱" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={editingAssignment ? '编辑投放排期' : '手动排投放'} open={assignmentModal} onCancel={() => setAssignmentModal(false)} onOk={() => void submitAssignment()} okText="保存" width={520}>
        <Form form={assignmentForm} layout="vertical">
          <Form.Item name="contractId" label="租蜂合同" rules={[{ required: true }]}>
            <Select options={contracts.map((item) => ({ value: item.id, label: `${item.code}（${item.supplier} · ${item.boxCount} 箱）` }))} />
          </Form.Item>
          <Form.Item name="orchardId" label="投放地块" rules={[{ required: true }]}>
            <Select options={orchards.map((item) => ({ value: item.id, label: `${item.name}（花期 ${item.bloomStart} ~ ${item.bloomEnd}）` }))} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={10}>
              <Form.Item name="boxes" label="投放箱数" rules={[{ required: true }]}>
                <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="箱" />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="range" label="投放起止" rules={[{ required: true }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
