"""
FastAPI 后端 - 使用 DuckDB 重写
所有接口、变量名、逻辑行为与原版一致，但内部存储与查询改用 DuckDB 实现
新增：跨表合并时，无论是否匹配都显示所有列，无匹配单元格为空
"""

import re
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import duckdb
import pandas as pd

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== 全局 DuckDB 内存数据库 ==========
con = duckdb.connect(":memory:")

# 保留原 DATA_STORE 变量，但仅存储表结构信息（列名），实际数据在 DuckDB 中
DATA_STORE: Dict[str, Dict[str, Any]] = {}

# ---------- 请求模型 ----------
class UploadData(BaseModel):
    tables: List[Dict[str, Any]]

# ---------- 工具函数（保持不变） ----------
def extract_digits(s: Any) -> str:
    """从任意值中提取连续数字字符"""
    return re.sub(r'\D', '', str(s)) if s is not None else ""

def match_score(query: str, target: str) -> int:
    """
    模糊匹配得分：
      - 若 query 是 target 的子串，返回 100 - 起始位置（位置越靠前得分越高）
      - 否则返回 -1
    """
    if not query or not target:
        return -1
    idx = target.find(query)
    return 100 - idx if idx != -1 else -1

# ---------- 上传 ----------
@app.post("/upload")
async def upload(upload_data: UploadData):
    global DATA_STORE
    for table in upload_data.tables:
        name = table["name"]
        rows = table["data"]
        if not rows:
            continue

        # 构建 DataFrame，强制所有列为字符串类型（避免 Pandas 推断数字/日期）
        df = pd.DataFrame(rows, dtype=str)

        # 查找 Item Code 列名（忽略大小写）
        item_col_name = next((c for c in df.columns if c.lower() == "item code"), None)
        if item_col_name:
            # 去除 Item Code 列的首尾空格
            df[item_col_name] = df[item_col_name].str.strip()
            print(f"[{name}] Found Item Code column: '{item_col_name}'")
            print(f"  Sample values: {df[item_col_name].head(3).tolist()}")
        else:
            print(f"[{name}] WARNING: No 'Item Code' column found! Columns: {list(df.columns)}")

        # 删除同名旧表（如果存在）
        con.execute(f'DROP TABLE IF EXISTS "{name}"')
        con.register("temp_view", df)
        con.execute(f'CREATE TABLE "{name}" AS SELECT * FROM temp_view')
        con.unregister("temp_view")

        # 存储列名信息（保留原始列名，用于后续匹配）
        DATA_STORE[name] = {"columns": list(df.columns)}
        print(f"[{name}] Table created with columns: {list(df.columns)}")

    return {"message": "uploaded", "table_count": len(DATA_STORE)}

@app.get("/tables")
async def get_tables():
    return {"tables": list(DATA_STORE.keys())}

@app.get("/uom_values")
async def get_uom_values(table: str = Query(...)):
    """返回指定表 UOM 列的去重值"""
    if table not in DATA_STORE:
        return {"values": []}
    columns = DATA_STORE[table]["columns"]
    uom_col = next((c for c in columns if c.lower() == "uom"), None)
    if not uom_col:
        return {"values": []}
    result = con.execute(f'SELECT DISTINCT "{uom_col}" FROM "{table}" WHERE "{uom_col}" IS NOT NULL ORDER BY "{uom_col}"').fetchall()
    values = [str(row[0]) for row in result if row[0] is not None]
    return {"values": values}

# ---------- SKU 模糊建议（下拉选项，改为开头匹配） ----------
@app.get("/sku_suggestions")
async def sku_suggestions(
    table: str = Query(...),
    q: str = Query("", description="用户输入的数字子串"),
):
    if table not in DATA_STORE:
        return {"suggestions": []}
    columns = DATA_STORE[table]["columns"]
    sku_col = next((c for c in columns if c.lower() == "description"), None)
    if not sku_col:
        return {"suggestions": []}

    result = con.execute(f'SELECT DISTINCT "{sku_col}" FROM "{table}" WHERE "{sku_col}" IS NOT NULL').fetchall()
    all_values = [str(row[0]) for row in result if row[0] is not None]

    score_map = {}
    for val in all_values:
        digits = extract_digits(val)
        # 改为开头匹配
        if q and not digits.startswith(q):
            continue
        score = match_score(q, digits) if q else 100
        if val not in score_map or score > score_map[val]:
            score_map[val] = score

    sorted_vals = sorted(score_map.items(), key=lambda x: -x[1])[:30]
    return {"suggestions": [v[0] for v in sorted_vals]}

# ---------- Customer 模糊建议（下拉选项） ----------
@app.get("/customer_suggestions")
async def customer_suggestions(
    table: str = Query(...),
    q: str = Query("", description="用户输入的字符串"),
):
    if table not in DATA_STORE:
        return {"suggestions": []}
    columns = DATA_STORE[table]["columns"]
    cust_col = next((c for c in columns if c.lower() == "company name"), None)
    if not cust_col:
        return {"suggestions": []}

    result = con.execute(f'SELECT DISTINCT "{cust_col}" FROM "{table}" WHERE "{cust_col}" IS NOT NULL').fetchall()
    all_values = [str(row[0]) for row in result if row[0] is not None]

    q_lower = q.lower()
    score_map = {}
    for val in all_values:
        val_lower = val.lower()
        if q and q_lower not in val_lower:
            continue
        score = match_score(q_lower, val_lower) if q else 100
        if val not in score_map or score > score_map[val]:
            score_map[val] = score

    sorted_vals = sorted(score_map.items(), key=lambda x: -x[1])[:20]
    return {"suggestions": [v[0] for v in sorted_vals]}

# ---------- 主查询 ----------
@app.get("/query")
async def query_data(
    table: str = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    sku: Optional[List[str]] = Query(None),
    tk: Optional[str] = Query(None),
    id_wd: Optional[str] = Query(None, alias="id_wd"),
    len_val: Optional[str] = Query(None, alias="len"),
    customer: Optional[List[str]] = Query(None),
    uom: Optional[List[str]] = Query(None),
):
    if table not in DATA_STORE:
        return {"total": 0, "data": [], "columns": [], "message": "Table not found"}

    columns = DATA_STORE[table]["columns"]
    item_col = next((c for c in columns if c.lower() == "item code"), None)
    if not item_col:
        return {"total": 0, "data": [], "columns": [], "message": "No 'Item Code' column"}

    # ---------- 预处理 SKU 精确/模糊分类 ----------
    exact_skus = set()
    fuzzy_skus = []
    if sku:
        sku_col = next((c for c in columns if c.lower() == "description"), None)
        if sku_col:
            all_desc = con.execute(f'SELECT DISTINCT "{sku_col}" FROM "{table}" WHERE "{sku_col}" IS NOT NULL').fetchall()
            all_descriptions = {str(row[0]) for row in all_desc}
            for sel in sku:
                if sel in all_descriptions:
                    exact_skus.add(sel)
                else:
                    digits = extract_digits(sel)
                    if digits:
                        fuzzy_skus.append(digits)

    # ---------- 构建 SQL 查询条件 ----------
    conditions = []
    params = []
    if sku:
        sku_col = next((c for c in columns if c.lower() == "description"), None)
        if sku_col:
            if exact_skus and fuzzy_skus:
                placeholders = ",".join(["?" for _ in exact_skus])
                digit_col = f'REGEXP_REPLACE(CAST("{sku_col}" AS VARCHAR), \'\\D\', \'\', \'g\')'
                # 开头匹配正则
                pattern = "^(" + "|".join(re.escape(fs) for fs in fuzzy_skus) + ")"
                conditions.append(f'("{sku_col}" IN ({placeholders}) AND {digit_col} ~ ?)')
                params.extend(list(exact_skus))
                params.append(pattern)
            elif exact_skus:
                placeholders = ",".join(["?" for _ in exact_skus])
                conditions.append(f'"{sku_col}" IN ({placeholders})')
                params.extend(list(exact_skus))
            elif fuzzy_skus:
                digit_col = f'REGEXP_REPLACE(CAST("{sku_col}" AS VARCHAR), \'\\D\', \'\', \'g\')'
                pattern = "^(" + "|".join(re.escape(fs) for fs in fuzzy_skus) + ")"
                conditions.append(f"{digit_col} ~ ?")
                params.append(pattern)

    if tk:
        tk_col = next((c for c in columns if c.lower() == "tk"), None)
        if tk_col:
            conditions.append(f'"{tk_col}" = ?')
            params.append(tk)

    if id_wd:
        id_col = next((c for c in columns if c.lower() in ("id/wd", "id_wd", "idwd")), None)
        if id_col:
            conditions.append(f'"{id_col}" = ?')
            params.append(id_wd)

    if len_val:
        len_col = next((c for c in columns if c.lower() == "len"), None)
        if len_col:
            conditions.append(f'"{len_col}" = ?')
            params.append(len_val)

    if customer:
        cust_col = next((c for c in columns if c.lower() == "company name"), None)
        if cust_col:
            placeholders = ",".join(["?" for _ in customer])
            conditions.append(f'"{cust_col}" IN ({placeholders})')
            params.extend(customer)

    if uom:
        uom_col = next((c for c in columns if c.lower() == "uom"), None)
        if uom_col:
            placeholders = ",".join(["?" for _ in uom])
            conditions.append(f'"{uom_col}" IN ({placeholders})')
            params.extend(uom)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    sql = f'SELECT * FROM "{table}" WHERE {where_clause}'
    df = con.execute(sql, params).fetchdf()

    filtered = df.to_dict(orient="records")

    # ---------- 排序 ----------
    if sku and fuzzy_skus:
        def sort_key(row):
            total_score = 0
            sku_col_name = next((c for c in columns if c.lower() == "description"), None)
            if sku_col_name:
                row_digits = extract_digits(row.get(sku_col_name))
                scores = [match_score(fs, row_digits) for fs in fuzzy_skus]
                total_score += max(scores) if scores else 0
            if customer:
                cust_col_name = next((c for c in columns if c.lower() == "company name"), None)
                if cust_col_name:
                    val_lower = str(row.get(cust_col_name, "")).lower()
                    total_score += max((match_score(sel.lower(), val_lower) for sel in customer), default=0)
            return -total_score
        filtered.sort(key=sort_key)
    elif customer:
        def sort_key(row):
            total_score = 0
            cust_col_name = next((c for c in columns if c.lower() == "company name"), None)
            if cust_col_name:
                val_lower = str(row.get(cust_col_name, "")).lower()
                total_score += max((match_score(sel.lower(), val_lower) for sel in customer), default=0)
            return -total_score
        filtered.sort(key=sort_key)

    total = len(filtered)
    start = (page - 1) * page_size
    page_rows = filtered[start:start + page_size]

    # ---------- 构建最终列名（主表 + 所有其他表的非 item code 列） ----------
    final_columns = list(columns)  # 主表所有列，保持顺序
    other_table_infos = []

    for other_name, other_info in DATA_STORE.items():
        if other_name == table:
            continue
        other_columns = other_info["columns"]
        other_item = next((c for c in other_columns if c.lower() == "item code"), None)
        if not other_item:
            continue

        col_mapping = {}
        for col in other_columns:
            if col.lower() == "item code":
                continue
            target = col
            if target in final_columns:  # 冲突时添加表名前缀
                target = f"{other_name}.{col}"
            col_mapping[col] = target
            if target not in final_columns:
                final_columns.append(target)

        other_table_infos.append({
            "name": other_name,
            "item_col": other_item,
            "col_mapping": col_mapping
        })

    # ---------- 构建每行数据（填充主表 + 尝试匹配其他表） ----------
    merged_data = []
    for row in page_rows:
        item_code = str(row.get(item_col, "")).strip()
        # 初始化一行，所有列为空字符串
        merged = {col: "" for col in final_columns}
        # 填充主表数据
        for col in columns:
            merged[col] = row.get(col, "")

        # 尝试匹配其他表
        for other_info in other_table_infos:
            other_name = other_info["name"]
            other_item_col = other_info["item_col"]
            col_mapping = other_info["col_mapping"]

            try:
                match_df = con.execute(
                    f'SELECT * FROM "{other_name}" WHERE TRIM("{other_item_col}") = TRIM(?)',
                    [item_code]
                ).fetchdf()
            except Exception as e:
                print(f"  Error querying table {other_name}: {e}")
                continue

            if not match_df.empty:
                match_row = match_df.iloc[0].to_dict()
                for orig_col, target_col in col_mapping.items():
                    merged[target_col] = match_row.get(orig_col, "")
            else:
                if item_code:
                    print(f"No match for Item Code '{item_code}' in table '{other_name}'")
                # 未匹配时保持为空，已初始化

        merged_data.append(merged)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": merged_data,
        "columns": final_columns,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)





