import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Upload, Button, Select, Input, Table, Space, message, Typography, Checkbox, Divider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";

const { Text } = Typography;

interface TableRecord {
  [key: string]: any;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

const App: React.FC = () => {
  // 上传与主表
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | undefined>(undefined);
  const [uomOptions, setUomOptions] = useState<string[]>([]);

  // 筛选条件
  const [tk, setTk] = useState("");
  const [idWd, setIdWd] = useState("");
  const [len, setLen] = useState("");
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedUoms, setSelectedUoms] = useState<string[]>([]);

  // SKU 相关状态
  const [skuSearch, setSkuSearch] = useState("");
  const [skuOptions, setSkuOptions] = useState<{ label: string; value: string }[]>([]);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);  // 用户手动选择的 SKU
  const debouncedSkuSearch = useDebounce(skuSearch, 300);

  // Customer 相关
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState<{ label: string; value: string }[]>([]);
  const debouncedCustomerSearch = useDebounce(customerSearch, 300);

  // 表格数据
  const [dataSource, setDataSource] = useState<TableRecord[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 防抖后的查询条件
  const dSkus = useDebounce(selectedSkus, 300);
  const dTk = useDebounce(tk, 300);
  const dIdWd = useDebounce(idWd, 300);
  const dLen = useDebounce(len, 300);
  const dCustomers = useDebounce(selectedCustomers, 300);
  const dUoms = useDebounce(selectedUoms, 300);

  // 全选/取消全选状态
  const isAllSelected = skuOptions.length > 0 && selectedSkus.length === skuOptions.length;

  // ==================== API 调用 ====================
  const fetchTables = async () => {
    const res = await fetch("http://localhost:8000/tables");
    const data = await res.json();
    setTableNames(data.tables || []);
  };

  const fetchUomValues = async (table: string) => {
    const res = await fetch(`http://localhost:8000/uom_values?table=${encodeURIComponent(table)}`);
    const data = await res.json();
    setUomOptions(data.values || []);
  };

  // 获取 SKU 建议
  useEffect(() => {
    if (!selectedTable) return;
    (async () => {
      const res = await fetch(
        `http://localhost:8000/sku_suggestions?table=${encodeURIComponent(selectedTable)}&q=${encodeURIComponent(debouncedSkuSearch)}`
      );
      const data = await res.json();
      const options = (data.suggestions || []).map((v: string) => ({ label: v, value: v }));
      setSkuOptions(options);
      // 默认全选新选项
      setSelectedSkus(options.map(o => o.value));
    })();
  }, [selectedTable, debouncedSkuSearch]);

  // 获取 Customer 建议
  useEffect(() => {
    if (!selectedTable) return;
    (async () => {
      const res = await fetch(
        `http://localhost:8000/customer_suggestions?table=${encodeURIComponent(selectedTable)}&q=${encodeURIComponent(debouncedCustomerSearch)}`
      );
      const data = await res.json();
      setCustomerOptions((data.suggestions || []).map((v: string) => ({ label: v, value: v })));
    })();
  }, [selectedTable, debouncedCustomerSearch]);

  const fetchQuery = useCallback(
    async (page: number) => {
      if (!selectedTable) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("table", selectedTable);
        params.append("page", String(page));
        params.append("page_size", String(pageSize));
        dSkus.forEach((s) => params.append("sku", s));
        if (dTk) params.append("tk", dTk);
        if (dIdWd) params.append("id_wd", dIdWd);
        if (dLen) params.append("len", dLen);
        dCustomers.forEach((c) => params.append("customer", c));
        dUoms.forEach((u) => params.append("uom", u));

        const res = await fetch(`http://localhost:8000/query?${params.toString()}`);
        const result = await res.json();
        if (result.data) {
          setDataSource(result.data);
          setTotal(result.total);
          setCurrentPage(result.page);
          if (result.columns) {
            setColumns(result.columns.map((col: string) => ({ title: col, dataIndex: col, key: col })));
          }
        } else {
          setDataSource([]);
          setTotal(0);
        }
      } catch (e) {
        console.error(e);
        message.error("网络错误");
      } finally {
        setLoading(false);
      }
    },
    [selectedTable, dSkus, dTk, dIdWd, dLen, dCustomers, dUoms]
  );

  useEffect(() => {
    if (selectedTable) fetchQuery(1);
  }, [selectedTable, dSkus, dTk, dIdWd, dLen, dCustomers, dUoms, fetchQuery]);

  useEffect(() => { fetchTables(); }, []);

  const handleTableChange = (value: string) => {
    setSelectedTable(value);
    fetchUomValues(value);
    setTk("");
    setIdWd("");
    setLen("");
    setSelectedCustomers([]);
    setSelectedUoms([]);
    setSkuSearch("");
    setCustomerSearch("");
    setSkuOptions([]);
    setSelectedSkus([]);
    setCustomerOptions([]);
    setCurrentPage(1);
  };

  const handleUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const tables: { name: string; data: TableRecord[] }[] = [];
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<TableRecord>(sheet, { defval: "", raw: false });
        if (json.length > 0) tables.push({ name: `${file.name}-${sheetName}`, data: json });
      });
      await fetch("http://localhost:8000/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables }),
      });
      message.success(`成功上传 ${tables.length} 张表`);
      fetchTables();
    } catch (e) {
      message.error("Excel 解析失败");
    }
    return false;
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedSkus([]);
    } else {
      setSelectedSkus(skuOptions.map(o => o.value));
    }
  };

  const clearSku = () => {
    setSkuSearch("");
    setSkuOptions([]);
    setSelectedSkus([]);
  };

  // ==================== 渲染 ====================
  return (
    <div style={{ padding: 24 }}>
      <h1>📊 Excel 多表查询 Demo</h1>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Upload beforeUpload={handleUpload} showUploadList={false} accept=".xlsx,.xls">
          <Button icon={<UploadOutlined />}>上传 Excel 文件</Button>
        </Upload>

        <Select
          style={{ width: 300 }}
          placeholder="选择主表"
          options={tableNames.map((n) => ({ label: n, value: n }))}
          value={selectedTable}
          onChange={handleTableChange}
          allowClear
        />

        <Space wrap>
          {/* SKU 筛选：仿 Excel filter */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Select
            mode="multiple"
            placeholder="SKU (搜索数字)"
            style={{ minWidth: 200, maxWidth: 400 }}
            dropdownStyle={{ maxWidth: 400 }}
            value={selectedSkus}
            onChange={setSelectedSkus}
            onSearch={(val) => setSkuSearch(val)}
            filterOption={false}
            options={skuOptions}
            dropdownRender={(menu) => (
              <div>
                <div style={{ padding: '4px 8px', borderBottom: '1px solid #f0f0f0' }}>
                  <Space>
                    <Checkbox
                      checked={isAllSelected}
                      indeterminate={!isAllSelected && selectedSkus.length > 0}
                      onChange={toggleSelectAll}
                    >
                      全选/取消
                    </Checkbox>
                    <Button type="link" size="small" onClick={clearSku} style={{ padding: 0 }}>
                      清空
                    </Button>
                  </Space>
                </div>
                <Divider style={{ margin: '4px 0' }} />
                {menu}
              </div>
            )}
            allowClear
            maxTagCount={0}   // 不显示任何具体标签
            maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`} // 只显示计数
            optionLabelProp="label"
            optionRender={(option) => (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {option.label}
              </div>
            )}
            popupMatchSelectWidth={false}
          />
            {/* 匹配数量提示 */}
            {skuSearch && (
              <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
                匹配 {skuOptions.length} 条
              </Text>
            )}
          </div>

          <Input placeholder="TK" value={tk} onChange={(e) => setTk(e.target.value)} style={{ width: 100 }} />
          <Input placeholder="ID/WD" value={idWd} onChange={(e) => setIdWd(e.target.value)} style={{ width: 100 }} />
          <Input placeholder="LEN" value={len} onChange={(e) => setLen(e.target.value)} style={{ width: 100 }} />

          <Select
            mode="multiple"
            placeholder="Customer"
            style={{ minWidth: 200, maxWidth: 400 }}
            dropdownStyle={{ maxWidth: 400 }}
            value={selectedCustomers}
            onChange={setSelectedCustomers}
            onSearch={(val) => setCustomerSearch(val)}
            filterOption={false}
            options={customerOptions}
            allowClear
            maxTagCount={0}
            maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
            optionLabelProp="label"
            optionRender={(option) => (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {option.label}
              </div>
            )}
            popupMatchSelectWidth={false}
          />

          <Select
            mode="multiple"
            placeholder="UOM"
            style={{ minWidth: 200, maxWidth: 400 }}
            dropdownStyle={{ maxWidth: 400 }}
            value={selectedUoms}
            onChange={setSelectedUoms}
            options={uomOptions.map((u) => ({ label: u, value: u }))}
            allowClear
            showSearch
            maxTagCount={0}
            maxTagPlaceholder={(omittedValues) => `+${omittedValues.length}`}
            optionLabelProp="label"
            optionRender={(option) => (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {option.label}
              </div>
            )}
            popupMatchSelectWidth={false}
          />
        </Space>

        <Table
          dataSource={dataSource}
          columns={columns}
          rowKey={(_, idx) => `${idx}`}
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize,
            total,
            onChange: (p) => { setCurrentPage(p); fetchQuery(p); },
            showTotal: (t) => `共 ${t} 条`,
          }}
          scroll={{ x: "max-content" }}
          bordered
        />
      </Space>
    </div>
  );
};

export default App;