"use client";
import { HistoryData } from "../types/HistoryData";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoryTableProps {
  data: HistoryData[];
}

export default function HistoryTable({ data }: HistoryTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "difficulty">("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string>("");

  const allTags = Array.from(
    new Set(data.flatMap((d) => d.question?.tags || []))
  );

  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };
  const filteredData = data.filter((item) => {
    const query = search.toLowerCase();
    const interviewerName = (
      item.interviewer?.name || "Solo-Practice"
    ).toLowerCase();
    const intervieweeName = (item.interviewee?.name || "").toLowerCase();
    const questionTitle = (item.question?.title || "").toLowerCase();
    const tags = item.question?.tags || [];

    const matchesSearch =
      interviewerName.includes(query) ||
      intervieweeName.includes(query) ||
      questionTitle.includes(query);

    const matchesTags =
      selectedTags.length === 0 || selectedTags.some((t) => tags.includes(t));

    return matchesSearch && matchesTags;
  });

  const sortedData = [...filteredData].sort((a, b) => {
    if (sortKey === "difficulty") {
      const order = { Easy: 1, Medium: 2, Hard: 3 };
      const aDiff = a.question?.difficulty ?? "";
      const bDiff = b.question?.difficulty ?? "";
      return sortAsc
        ? order[aDiff] - order[bDiff]
        : order[bDiff] - order[aDiff];
    }
    const aDate = new Date(a.created_at).getTime();
    const bDate = new Date(b.created_at).getTime();
    return sortAsc ? aDate - bDate : bDate - aDate;
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div className="w-full border rounded-md">
      <div className="flex items-center justify-between p-4">
        <h2 className="text-lg font-semibold">Interview History</h2>
        <Input
          placeholder="Search interviewer, interviewee, or question..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {allTags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "text-xs rounded-md px-2 py-1 border transition-colors",
                  active
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-[400px] transition-all">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Interviewer</TableHead>
              <TableHead>Interviewee</TableHead>
              <TableHead>Question</TableHead>

              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort("difficulty")}
              >
                <div className="flex items-center gap-1">
                  Difficulty
                  <ArrowUpDown
                    className={cn(
                      "h-4 w-4 transition-transform text-muted-foreground",
                      sortKey === "difficulty" && sortAsc && "rotate-180"
                    )}
                  />
                </div>
              </TableHead>

              <TableHead>Tags</TableHead>

              <TableHead
                className="text-right cursor-pointer select-none"
                onClick={() => toggleSort("date")}
              >
                <div className="flex items-center justify-end gap-1">
                  Date Attempted
                  <ArrowUpDown
                    className={cn(
                      "h-4 w-4 transition-transform text-muted-foreground",
                      sortKey === "date" && sortAsc && "rotate-180"
                    )}
                  />
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sortedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-6 text-muted-foreground"
                >
                  No results found
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-muted transition"
                  onClick={() => {
                    setSelectedCode(item.current_code);
                    setSelectedTitle(
                      item.question?.title || "Untitled Question"
                    );
                    setOpen(true);
                  }}
                >
                  <TableCell>
                    {item.interviewer?.name || "Solo-Practice"}
                  </TableCell>
                  <TableCell>{item.interviewee?.name || "Unknown"}</TableCell>
                  <TableCell>{item.question?.title || "Unknown"}</TableCell>

                  <TableCell>
                    {item.question && (
                      <span
                        className={cn(
                          "inline-block text-xs font-semibold px-2 py-1 rounded-md text-white",
                          item.question.difficulty === "Easy" &&
                            "bg-green-500/80",
                          item.question.difficulty === "Medium" &&
                            "bg-amber-500/80",
                          item.question.difficulty === "Hard" && "bg-red-500/80"
                        )}
                      >
                        {item.question.difficulty}
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[12rem]">
                      {item.question?.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs bg-gray-200 text-gray-700 rounded-md px-2 py-0.5 break-words"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    {new Date(item.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedTitle}</DialogTitle>
          </DialogHeader>

          <div className="mt-4">
            {selectedCode ? (
              <pre className="bg-muted rounded-md p-4 overflow-x-auto max-h-[60vh] text-sm font-mono whitespace-pre-wrap">
                {selectedCode}
              </pre>
            ) : (
              <p className="text-muted-foreground">
                No code submitted for this session.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
