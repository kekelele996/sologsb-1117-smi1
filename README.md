# 蜜蜂授粉路线规划器（gbbeeroute）

面向果园托管服务队与蜂场技术员，把「果园地块 → 花期 → 蜂群投放点 → 转场路线」排成季内可执行的授粉安排，解决花期重叠时蜂群撞车、转场距离过远、投放点与地块不匹配的问题；并按地块花期与需蜂强度计算**用蜂缺口**，自有群不够时再向邻县蜂场**租蜂补缺口**、登记合同与实际归还、自动折算费用。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21817>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbbeeroute
FRONTEND_PORT=21817
VITE_AMAP_KEY=            # 可选，留空即自动降级为本地 SVG 网格视图
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| UI 组件库 | Ant Design 5 |
| 地图 | 高德地图 JS API 2.0（可选，key 走 `VITE_AMAP_KEY`） |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、高德地图 Key 与降级策略

- 在 `.env` 里填写 `VITE_AMAP_KEY=<你的 key>` 后**重新构建**（`docker compose up -d --build`），地图将使用高德 JS API 渲染地块、投放点与转场折线；
- **未配置 key 或脚本加载失败时，`RouteMap` 自动降级为本地 SVG 网格视图**：按经纬度线性映射渲染地块、投放点与转场折线，支持点选拾取坐标；
- **构建与运行都不依赖该 key**：未配置 key 时不会注入任何外部脚本（避免无谓请求与报错），Docker 构建零网络依赖即可通过；
- 页面右上角始终显示当前数据源（高德地图 JS API / 本地 SVG 网格视图）。

## 四、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21817
npm run build      # 类型检查 + 生产构建
```

## 五、目录结构

```
sologsb-1117/
├── docker-compose.yml          # 顶层 name: gbbeeroute，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # orchard / colony / droppoint / route / rental / index
│       ├── stores/             # orchard / colony / droppoint / route / contract / assignment（Zustand）
│       ├── components/common/  # RouteMap / FlowerWindowBar / StatusTag / CoordPicker
│       ├── hooks/              # useAmap / usePersistentStore
│       ├── pages/              # Schedule / Orchards / Colonies / Rentals / Routes / Export
│       ├── router/index.tsx
│       └── utils/              # geo.ts / gap.ts（缺口/排期/费用引擎） / export.ts / id.ts
```

## 六、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Orchard 果园地块 | 地块名、作物、面积、经纬度、盛花期起止、需蜂强度（箱/亩）、园主联系方式、可达性、历史授粉年份 | `orchards` |
| BeeColony 蜂群 | 群号、蜂种、群势（足框）、箱型、来源（自有/租借）、关联租蜂合同、当前所在地块、状态（待投放/在园/转场中/回场）、最近检查日期、健康备注 | `colonies` |
| DropPoint 投放点 | 所属地块、坐标、编号、可容纳箱数、遮阴条件、水源距离、投放时间窗、撤场时间、责任人、安排群号 | `dropPoints` |
| TransitRoute 转场路线 | 出发/到达投放点、预计里程与耗时、车辆类型、出发时刻、风险备注、实际记录 | `routes` |
| RentalContract 租蜂合同 | 合同编号、出租方（邻县蜂场）、合同箱数、起租日、归租日、单价（元/箱·天）、联系方式、实际归还日期/箱数 | `contracts` |
| ContractAssignment 合同投放排段 | 合同、投放地块、箱数、投放起止日；同合同同日跨地块合计不超过合同箱数 | `assignments` |

- 数据库名 `gbbeeroute`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史投放点补齐「可容纳箱数」（默认 8 箱）；
- `version(3)` 新增蜂群「来源」字段与 `contracts`、`assignments` 两张表。**历史蜂群没有租借来源，升级时统一按「自有」补齐，不产生任何租蜂费用**；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 七、主要页面

| 路由 | 功能 |
| --- | --- |
| `/` | 季内授粉安排总表：花期条带 + 已投放群体，冲突（同一蜂群被排入花期重叠的不同地块）标红；附**用蜂缺口/在租箱数/租蜂费用只读汇总**与各地块缺口列 |
| `/orchards` | 果园地块管理：面积与需蜂强度自动算建议箱数、可达性标记、花期重叠提示、投放点维护（含容量与坐标拾取）；改花期/容量后缺口自动重算 |
| `/colonies` | 蜂群台账：按群势与状态筛选，批量改状态、批量记录检查备注；区分自有群与租借群（租借群关联租蜂合同） |
| `/rentals` | **租蜂合同与缺口（技术员）**：登记合同箱数/起租日/归租日/单价、按合同自动或手动排投放补缺口、到期前登记实际归还；费用预估只读展示 |
| `/routes` | 转场路线规划：地图依次选点生成顺序与里程，拖动或上下移动调整顺序并实时重算，写回路线表 |
| `/export` | 导出授粉安排清单 / 转场路线表 / **租蜂费用预估**（CSV）、全量 JSON 备份，并提供横向/纵向打印视图 |

### 分工与互不覆盖

- 果园托管服务队维护地块花期、需蜂强度、投放点容量，**只读**费用预估，不修改合同与归还登记；
- 蜂场技术员维护租蜂合同、投放排期与实际归还；
- 缺口、在租箱数、费用均为**派生只读结果**（见 `src/utils/gap.ts`），双方各自只改自己的表，任何一方保存都不会覆盖另一方的数据。

## 八、计算约定

- 建议箱数（花期需蜂） = ⌈面积(亩) × 需蜂强度(箱/亩)⌉，最少 1 箱；
- **缺口**按花期逐日计算：有效需求（需蜂受投放点容量封顶）− 自有群固定占用 − 机动自有池补位 − 已排租蜂；自有群不够才产生缺口。机动自有池为全局共享，按起花期顺序逐日先到先得，故同一自有群可在不重叠花期内连续转场；
- **租蜂补缺口**：按合同箱数补排，起租日早、合同编号小的合同优先；同一份合同同一天不能同时投放在两个地块（跨地块当日合计 ≤ 合同箱数），排期须同时落在合同租期与地块盛花期内；
- **费用预估**（到期前登记实际归还日期与归还箱数后）：
  - 超期天数 = max(0, 实际归还日 − 归租日)；未登记归还且已到期时按当天给提示性预估；
  - 超期费用 = 超期天数 × 合同箱数 × 合同单价；
  - 缺箱费用 = (合同箱数 − 实际归还箱数) × 合同单价（未登记归还时不预估缺箱）；
  - 历史自有群不参与租蜂、不产生费用；
- 转场里程按 Haversine 球面距离累计，耗时按平均 32 km/h + 0.25 h 装卸估算；
- 花期重叠：两地块盛花期区间交集天数 ≥ 1 即视为重叠；同一群号在重叠期内被排入两个地块 → 冲突。
