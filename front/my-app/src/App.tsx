import React, { useState, useEffect, useCallback } from "react";
import { Upload, Button, Select, Input, Table, Space, message, Typography, Checkbox, Divider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";

const { Text } = Typography;

// ==================== 类型定义 ====================
interface TableRecord {
  [key: string]: any;
}

interface SelectOption {
  label: string;
  value: string;
}

interface ApiResponse {
  tables?: string[];
  values?: string[];
  suggestions?: string[];
  data?: TableRecord[];
  total?: number;
  page?: number;
  columns?: string[];
}

// ==================== 工具函数 ====================
// 安全的环境变量获取
const getApiBaseUrl = (): string => {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.REACT_APP_API_URL) {
      return process.env.REACT_APP_API_URL;
    }
    return '';
  }
  return 'http://localhost:8000';
};

const API_BASE_URL = getApiBaseUrl();

// 构建完整的API URL
const buildApiUrl = (endpoint: string): string => {
  const baseUrl = API_BASE_URL;
  if (baseUrl) {
    return `${baseUrl}${endpoint}`;
  }
  return endpoint;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ==================== 主组件 ====================
const App: React.FC = () => {
  // 上传与主表
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | undefined>(undefined);
  const [uomOptions, setUomOptions] = useState<string[]>([]);

  // 筛选条件
  const [tk, setTk] = useState<string>("");
  const [idWd, setIdWd] = useState<string>("");
  const [len, setLen] = useState<string>("");
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [selectedUoms, setSelectedUoms] = useState<string[]>([]);

  // SKU 相关状态
  const [skuSearch, setSkuSearch] = useState<string>("");
  const [skuOptions, setSkuOptions] = useState<SelectOption[]>([]);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const debouncedSkuSearch = useDebounce<string>(skuSearch, 300);

  // Customer 相关
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [customerOptions, setCustomerOptions] = useState<SelectOption[]>([]);
  const debouncedCustomerSearch = useDebounce<string>(customerSearch, 300);

  // 表格数据
  const [dataSource, setDataSource] = useState<TableRecord[]>([]);
  const [columns, setColumns] = useState<Array<{ title: string; dataIndex: string; key: string }>>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize: number = 10;

  // 防抖后的查询条件
  const dSkus = useDebounce<string[]>(selectedSkus, 300);
  const dTk = useDebounce<string>(tk, 300);
  const dIdWd = useDebounce<string>(idWd, 300);
  const dLen = useDebounce<string>(len, 300);
  const dCustomers = useDebounce<string[]>(selectedCustomers, 300);
  const dUoms = useDebounce<string[]>(selectedUoms, 300);

  // 全选/取消全选状态
  const isAllSelected: boolean = skuOptions.length > 0 && selectedSkus.length === skuOptions.length;

  // ==================== API 调用 ====================
  const fetchTables = useCallback(async (): Promise<void> => {
    try {
      const url = buildApiUrl('/tables');
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data: ApiResponse = await res.json();
      setTableNames(data.tables || []);
    } catch (error) {
      console.error('获取表列表失败:', error);
      if (process.env.NODE_ENV === 'development') {
        message.error(`加载表列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } else {
        message.error('加载表列表失败，请稍后重试');
      }
      setTableNames([]);
    }
  }, []);

  const fetchUomValues = useCallback(async (table: string): Promise<void> => {
    try {
      const url = buildApiUrl(`/uom_values?table=${encodeURIComponent(table)}`);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data: ApiResponse = await res.json();
      setUomOptions(data.values || []);
    } catch (error) {
      console.error('获取UOM值失败:', error);
      setUomOptions([]);
      if (process.env.NODE_ENV === 'development') {
        message.error('加载UOM选项失败');
      }
    }
  }, []);

  // 获取 SKU 建议
  useEffect(() => {
    if (!selectedTable) return;
    
    let isMounted: boolean = true;
    
    const fetchSkuSuggestions = async (): Promise<void> => {
      try {
        const url = buildApiUrl(
          `/sku_suggestions?table=${encodeURIComponent(selectedTable)}&q=${encodeURIComponent(debouncedSkuSearch)}`
        );
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data: ApiResponse = await res.json();
        if (isMounted) {
          const options: SelectOption[] = (data.suggestions || []).map((v: string) => ({ label: v, value: v }));
          setSkuOptions(options);
          setSelectedSkus(options.map((o: SelectOption) => o.value));
        }
      } catch (error) {
        console.error('获取SKU建议失败:', error);
        if (isMounted) {
          setSkuOptions([]);
          setSelectedSkus([]);
        }
      }
    };

    fetchSkuSuggestions();

    return () => {
      isMounted = false;
    };
  }, [selectedTable, debouncedSkuSearch]);

  // 获取 Customer 建议
  useEffect(() => {
    if (!selectedTable) return;
    
    let isMounted: boolean = true;
    
    const fetchCustomerSuggestions = async (): Promise<void> => {
      try {
        const url = buildApiUrl(
          `/customer_suggestions?table=${encodeURIComponent(selectedTable)}&q=${encodeURIComponent(debouncedCustomerSearch)}`
        );
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data: ApiResponse = await res.json();
        if (isMounted) {
          setCustomerOptions((data.suggestions || []).map((v: string) => ({ label: v, value: v })));
        }
      } catch (error) {
        console.error('获取Customer建议失败:', error);
        if (isMounted) {
          setCustomerOptions([]);
        }
      }
    };

    fetchCustomerSuggestions();

    return () => {
      isMounted = false;
    };
  }, [selectedTable, debouncedCustomerSearch]);

  const fetchQuery = useCallback(
    async (page: number): Promise<void> => {
      if (!selectedTable) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.append("table", selectedTable);
        params.append("page", String(page));
        params.append("page_size", String(pageSize));
        dSkus.forEach((s: string) => params.append("sku", s));
        if (dTk) params.append("tk", dTk);
        if (dIdWd) params.append("id_wd", dIdWd);
        if (dLen) params.append("len", dLen);
        dCustomers.forEach((c: string) => params.append("customer", c));
        dUoms.forEach((u: string) => params.append("uom", u));

        const url = buildApiUrl(`/query?${params.toString()}`);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const result: ApiResponse = await res.json();
        if (result.data) {
          setDataSource(result.data);
          setTotal(result.total || 0);
          setCurrentPage(result.page || 1);
          if (result.columns) {
            setColumns(result.columns.map((col: string) => ({ title: col, dataIndex: col, key: col })));
          }
        } else {
          setDataSource([]);
          setTotal(0);
        }
      } catch (error) {
        console.error("查询失败:", error);
        if (process.env.NODE_ENV === 'development') {
          message.error(`网络错误: ${error instanceof Error ? error.message : '未知错误'}`);
        } else {
          message.error("查询失败，请稍后重试");
        }
        setDataSource([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [selectedTable, dSkus, dTk, dIdWd, dLen, dCustomers, dUoms]
  );

  useEffect(() => {
    if (selectedTable) {
      fetchQuery(1);
    }
  }, [selectedTable, dSkus, dTk, dIdWd, dLen, dCustomers, dUoms, fetchQuery]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const handleTableChange = (value: string | undefined): void => {
    setSelectedTable(value);
    if (value) {
      fetchUomValues(value);
    }
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

  const handleUpload = async (file: File): Promise<boolean> => {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const tables: Array<{ name: string; data: TableRecord[] }> = [];
      workbook.SheetNames.forEach((sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<TableRecord>(sheet, { defval: "", raw: false });
        if (json.length > 0) {
          tables.push({ name: `${file.name}-${sheetName}`, data: json });
        }
      });
      
      const url = buildApiUrl('/upload');
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables }),
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      message.success(`成功上传 ${tables.length} 张表`);
      await fetchTables();
    } catch (error) {
      console.error("Excel 解析或上传失败:", error);
      message.error("上传失败，请检查文件格式");
    }
    return false;
  };

  const toggleSelectAll = (): void => {
    if (isAllSelected) {
      setSelectedSkus([]);
    } else {
      setSelectedSkus(skuOptions.map((o: SelectOption) => o.value));
    }
  };

  const clearSku = (): void => {
    setSkuSearch("");
    setSkuOptions([]);
    setSelectedSkus([]);
  };

  // 获取安全的rowKey
  const getRowKey = (record: TableRecord, index: number): string => {
    if (record.id) return String(record.id);
    if (record._id) return String(record._id);
    if (record.key) return String(record.key);
    const sku = record.sku || record.SKU || '';
    const tkValue = record.tk || record.TK || '';
    return `${sku}-${tkValue}-${index}`;
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
          options={tableNames.map((n: string) => ({ label: n, value: n }))}
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
              onChange={(value: string[]) => setSelectedSkus(value)}
              onSearch={(val: string) => setSkuSearch(val)}
              filterOption={false}
              options={skuOptions}
              dropdownRender={(menu: React.ReactNode) => (
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
              maxTagCount={0}
              maxTagPlaceholder={(omittedValues: SelectOption[]) => `+${omittedValues.length}`}
              optionLabelProp="label"
              optionRender={(option: SelectOption) => (
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

          <Input 
            placeholder="TK" 
            value={tk} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTk(e.target.value)} 
            style={{ width: 100 }} 
          />
          <Input 
            placeholder="ID/WD" 
            value={idWd} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIdWd(e.target.value)} 
            style={{ width: 100 }} 
          />
          <Input 
            placeholder="LEN" 
            value={len} 
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLen(e.target.value)} 
            style={{ width: 100 }} 
          />

          <Select
            mode="multiple"
            placeholder="Customer"
            style={{ minWidth: 200, maxWidth: 400 }}
            dropdownStyle={{ maxWidth: 400 }}
            value={selectedCustomers}
            onChange={(value: string[]) => setSelectedCustomers(value)}
            onSearch={(val: string) => setCustomerSearch(val)}
            filterOption={false}
            options={customerOptions}
            allowClear
            maxTagCount={0}
            maxTagPlaceholder={(omittedValues: SelectOption[]) => `+${omittedValues.length}`}
            optionLabelProp="label"
            optionRender={(option: SelectOption) => (
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
            onChange={(value: string[]) => setSelectedUoms(value)}
            options={uomOptions.map((u: string) => ({ label: u, value: u }))}
            allowClear
            showSearch
            maxTagCount={0}
            maxTagPlaceholder={(omittedValues: SelectOption[]) => `+${omittedValues.length}`}
            optionLabelProp="label"
            optionRender={(option: SelectOption) => (
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
          rowKey={getRowKey}
          loading={loading}
          pagination={{
            current: currentPage,
            pageSize,
            total,
            onChange: (page: number) => {
              setCurrentPage(page);
              fetchQuery(page);
            },
            showTotal: (total: number) => `共 ${total} 条`,
          }}
          scroll={{ x: "max-content" }}
          bordered
        />
      </Space>
    </div>
  );
};

export default App;