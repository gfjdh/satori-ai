<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { dbApi, type ColumnInfo, type TableData } from '@/api'

// 状态
const tables = ref<string[]>([])
const selectedTable = ref<string>('')
const tableData = ref<TableData | null>(null)
const isLoading = ref(false)

// 分页
const currentPage = ref(1)
const pageSize = ref(20)

// 排序
const sortColumn = ref<string>('')
const sortOrder = ref<'asc' | 'desc'>('asc')

// 筛选
const filterText = ref('')

// 编辑
const editingRow = ref<Record<string, any> | null>(null)
const editForm = ref<Record<string, any>>({})

// 加载表列表
async function loadTables() {
  try {
    const res = await dbApi.getTables()
    tables.value = res.data || []
    if (tables.value.length > 0 && !selectedTable.value) {
      selectedTable.value = tables.value[0]
    }
  } catch (e) {
    console.error('Failed to load tables:', e)
  }
}

// 加载表数据
async function loadTableData() {
  if (!selectedTable.value) return

  isLoading.value = true
  try {
    const res = await dbApi.getTableData(selectedTable.value, {
      page: currentPage.value,
      pageSize: pageSize.value,
      sort: sortColumn.value || undefined,
      order: sortOrder.value,
      filter: filterText.value || undefined
    })
    tableData.value = res.data
  } catch (e) {
    console.error('Failed to load table data:', e)
  }
  isLoading.value = false
}

// 选择表
function selectTable(table: string) {
  selectedTable.value = table
  currentPage.value = 1
  sortColumn.value = ''
  filterText.value = ''
  loadTableData()
}

// 排序
function toggleSort(column: string) {
  if (sortColumn.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = column
    sortOrder.value = 'asc'
  }
  loadTableData()
}

// 筛选
function applyFilter() {
  currentPage.value = 1
  loadTableData()
}

// 分页
function goToPage(page: number) {
  currentPage.value = page
  loadTableData()
}

// 获取主键列名
const primaryKey = computed(() => {
  if (!tableData.value) return ''
  const pk = tableData.value.columns.find(c => c.primaryKey)
  return pk?.name || ''
})

// 获取主键值
function getRowId(row: Record<string, any>): string {
  return String(row[primaryKey.value])
}

// 开始编辑
function startEdit(row: Record<string, any>) {
  editingRow.value = { ...row }
  editForm.value = { ...row }
}

// 取消编辑
function cancelEdit() {
  editingRow.value = null
  editForm.value = {}
}

// 保存编辑
async function saveEdit() {
  if (!editingRow.value || !selectedTable.value) return

  try {
    const id = getRowId(editingRow.value)
    await dbApi.updateRow(selectedTable.value, id, editForm.value)
    editingRow.value = null
    editForm.value = {}
    loadTableData()
  } catch (e) {
    console.error('Failed to save:', e)
    alert('保存失败')
  }
}

// 删除行
async function deleteRow(row: Record<string, any>) {
  if (!selectedTable.value) return
  if (!confirm('确定删除这条记录？')) return

  try {
    const id = getRowId(row)
    await dbApi.deleteRow(selectedTable.value, id)
    loadTableData()
  } catch (e) {
    console.error('Failed to delete:', e)
    alert('删除失败')
  }
}

// 格式化值
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// 截断文本
function truncate(text: string, maxLen: number = 50): string {
  if (text.length <= maxLen) return text
  return text.substring(0, maxLen) + '...'
}

onMounted(() => {
  loadTables()
})

watch(selectedTable, () => {
  loadTableData()
})
</script>

<template>
  <div class="database-view">
    <div class="db-header">
      <h2>数据库管理</h2>
    </div>

    <div class="db-layout">
      <!-- 侧边栏：表列表 -->
      <div class="sidebar">
        <div class="sidebar-title">表 ({{ tables.length }})</div>
        <ul class="table-list">
          <li
            v-for="table in tables"
            :key="table"
            :class="{ active: table === selectedTable }"
            @click="selectTable(table)"
          >
            {{ table }}
          </li>
        </ul>
      </div>

      <!-- 主区域：数据表格 -->
      <div class="main-area">
        <div v-if="selectedTable" class="table-container">
          <!-- 工具栏 -->
          <div class="toolbar">
            <div class="filter-group">
              <input
                v-model="filterText"
                type="text"
                placeholder="模糊筛选..."
                class="filter-input"
                @keyup.enter="applyFilter"
              />
              <button @click="applyFilter">筛选</button>
            </div>
            <div class="pagination-info">
              <span v-if="tableData">
                共 {{ tableData.pagination.total }} 条，
                第 {{ currentPage }} / {{ tableData.pagination.totalPages }} 页
              </span>
            </div>
          </div>

          <!-- 加载状态 -->
          <div v-if="isLoading" class="loading">加载中...</div>

          <!-- 数据表格 -->
          <div v-else-if="tableData" class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th
                    v-for="col in tableData.columns"
                    :key="col.name"
                    :class="{ sortable: true, sorted: sortColumn === col.name }"
                    @click="toggleSort(col.name)"
                  >
                    <span class="col-name">
                      {{ col.name }}
                      <span v-if="col.primaryKey" class="pk-badge">PK</span>
                    </span>
                    <span v-if="sortColumn === col.name" class="sort-indicator">
                      {{ sortOrder === 'asc' ? '▲' : '▼' }}
                    </span>
                  </th>
                  <th class="actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="tableData.data.length === 0">
                  <td :colspan="tableData.columns.length + 1" class="empty-cell">
                    暂无数据
                  </td>
                </tr>
                <tr v-else v-for="(row, idx) in tableData.data" :key="idx">
                  <template v-if="editingRow && getRowId(editingRow) === getRowId(row)">
                    <td v-for="col in tableData.columns" :key="col.name">
                      <input
                        v-model="editForm[col.name]"
                        class="edit-input"
                        :disabled="col.primaryKey"
                      />
                    </td>
                    <td class="actions-cell">
                      <button class="btn-save" @click="saveEdit">保存</button>
                      <button class="btn-cancel" @click="cancelEdit">取消</button>
                    </td>
                  </template>
                  <template v-else>
                    <td v-for="col in tableData.columns" :key="col.name">
                      <span :title="formatValue(row[col.name])">
                        {{ truncate(formatValue(row[col.name])) }}
                      </span>
                    </td>
                    <td class="actions-cell">
                      <button class="btn-edit" @click="startEdit(row)">编辑</button>
                      <button class="btn-delete" @click="deleteRow(row)">删除</button>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 分页 -->
          <div v-if="tableData && tableData.pagination.totalPages > 1" class="pagination">
            <button
              :disabled="currentPage <= 1"
              @click="goToPage(1)"
            >首页</button>
            <button
              :disabled="currentPage <= 1"
              @click="goToPage(currentPage - 1)"
            >上一页</button>
            <span class="page-info">
              {{ currentPage }} / {{ tableData.pagination.totalPages }}
            </span>
            <button
              :disabled="currentPage >= tableData.pagination.totalPages"
              @click="goToPage(currentPage + 1)"
            >下一页</button>
            <button
              :disabled="currentPage >= tableData.pagination.totalPages"
              @click="goToPage(tableData.pagination.totalPages)"
            >末页</button>
          </div>
        </div>

        <div v-else class="no-table">
          请选择左侧表查看数据
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.database-view {
  height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
}

.db-header {
  margin-bottom: 20px;
}

.db-header h2 {
  font-size: 22px;
}

.db-layout {
  flex: 1;
  display: flex;
  gap: 20px;
  min-height: 0;
}

/* Sidebar */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow-y: auto;
}

.sidebar-title {
  padding: 16px;
  font-size: 14px;
  color: #888;
  border-bottom: 1px solid #eee;
}

.table-list {
  list-style: none;
}

.table-list li {
  padding: 12px 16px;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 1px solid #f5f5f5;
  transition: all 0.2s;
  color: #333;
}

.table-list li:hover {
  background: #f9f9f9;
}

.table-list li.active {
  background: #ff6b9d;
  color: white;
}

/* Main Area */
.main-area {
  flex: 1;
  min-width: 0;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.table-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.no-table {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #eee;
}

.filter-group {
  display: flex;
  gap: 8px;
}

.filter-input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  width: 200px;
  font-size: 13px;
}

.filter-input:focus {
  outline: none;
  border-color: #ff6b9d;
}

.toolbar button {
  padding: 8px 16px;
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.toolbar button:hover {
  background: #eee;
}

.pagination-info {
  font-size: 13px;
  color: #666;
}

/* Table */
.loading {
  padding: 40px;
  text-align: center;
  color: #999;
}

.table-wrapper {
  flex: 1;
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-table th {
  background: #f9f9f9;
  font-weight: 500;
  color: #666;
  position: sticky;
  top: 0;
  z-index: 1;
}

.data-table th.sortable {
  cursor: pointer;
  user-select: none;
}

.data-table th.sortable:hover {
  background: #f0f0f0;
}

.data-table th.sorted {
  color: #ff6b9d;
}

.col-name {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pk-badge {
  font-size: 9px;
  padding: 1px 4px;
  background: #ff9800;
  color: white;
  border-radius: 3px;
}

.sort-indicator {
  font-size: 10px;
  margin-left: 4px;
}

.actions-col {
  width: 120px;
  text-align: center;
}

.actions-cell {
  text-align: center;
}

.empty-cell {
  text-align: center;
  color: #999;
  padding: 40px !important;
}

.actions-cell button {
  padding: 4px 8px;
  margin: 0 2px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.btn-edit {
  background: #e3f2fd;
  color: #1976d2;
}

.btn-delete {
  background: #ffebee;
  color: #d32f2f;
}

.btn-save {
  background: #e8f5e9;
  color: #388e3c;
}

.btn-cancel {
  background: #f5f5f5;
  color: #666;
}

.edit-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
}

.edit-input:disabled {
  background: #f5f5f5;
  color: #999;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #eee;
}

.pagination button {
  padding: 6px 12px;
  background: #f5f5f5;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination button:hover:not(:disabled) {
  background: #eee;
}

.page-info {
  padding: 0 16px;
  font-size: 13px;
  color: #666;
}
</style>
