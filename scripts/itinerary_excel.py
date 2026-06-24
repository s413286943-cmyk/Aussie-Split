import json
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook


def write_workbook(input_path, workbook_path):
    payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
    workbook = Workbook()
    default = workbook.active
    workbook.remove(default)

    for sheet_name in ("Days", "Blocks", "Resources"):
        rows = payload[sheet_name]
        sheet = workbook.create_sheet(sheet_name)
        headers = list(rows[0].keys())
        sheet.append(headers)
        for row in rows:
            sheet.append([row.get(header, "") for header in headers])

    Path(workbook_path).parent.mkdir(parents=True, exist_ok=True)
    workbook.save(workbook_path)


def read_workbook(workbook_path):
    workbook = load_workbook(workbook_path, data_only=True)
    result = {}
    for sheet_name in ("Days", "Blocks", "Resources"):
        sheet = workbook[sheet_name]
        rows = list(sheet.iter_rows(values_only=True))
        headers = [str(value or "").strip() for value in rows[0]]
        result[sheet_name] = [
            {
                header: "" if value is None else value
                for header, value in zip(headers, row)
            }
            for row in rows[1:]
            if any(value is not None and value != "" for value in row)
        ]
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "write":
        write_workbook(sys.argv[2], sys.argv[3])
    elif command == "read":
        read_workbook(sys.argv[2])
    else:
        raise SystemExit(f"Unknown command: {command}")
