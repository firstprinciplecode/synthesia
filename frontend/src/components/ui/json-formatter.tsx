"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

interface JsonFormatterProps {
  data: JSONValue;
  title?: string;
  className?: string;
  defaultExpanded?: boolean;
  showCopyButton?: boolean;
}

export function JsonFormatter({ 
  data, 
  title, 
  className,
  defaultExpanded = true,
  showCopyButton = true 
}: JsonFormatterProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showRaw, setShowRaw] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const renderValue = (value: JSONValue, key?: string): React.ReactNode => {
    if (value === null) return <span className="text-muted-foreground">null</span>;
    if (value === undefined) return <span className="text-muted-foreground">undefined</span>;
    if (typeof value === 'boolean') return <span className="text-blue-500">{value.toString()}</span>;
    if (typeof value === 'number') return <span className="text-green-500">{value}</span>;
    if (typeof value === 'string') {
      // Check if it's a URL
      if (value.match(/^https?:\/\//)) {
        return (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            {value}
          </a>
        );
      }
      return <span className="text-orange-500">&quot;{value}&quot;</span>;
    }
    if (Array.isArray(value)) {
      return (
        <div className="ml-2">
          <div className="text-muted-foreground">[</div>
          {(value as JSONValue[]).map((item, index) => (
            <div key={index} className="ml-2">
              {renderValue(item, index.toString())}
              {index < value.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
          <div className="text-muted-foreground">]</div>
        </div>
      );
    }
    if (typeof value === 'object') {
      return (
        <div className="ml-2">
          <div className="text-muted-foreground">{'{'}</div>
          {Object.entries(value as { [key: string]: JSONValue }).map(([k, v], index, arr) => (
            <div key={k} className="ml-2">
              <span className="text-purple-500">&quot;{k}&quot;</span>
              <span className="text-muted-foreground">: </span>
              {renderValue(v, k)}
              {index < arr.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
          <div className="text-muted-foreground">{'}'}</div>
        </div>
      );
    }
    return <span className="text-foreground">{String(value)}</span>;
  };

  const renderTable = (data: JSONValue): React.ReactNode => {
    if (!data || typeof data !== 'object') return null;

    // If it's an array of objects, render as table
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      const keys = Object.keys(data[0] as Record<string, JSONValue>);
      return (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                {keys.map(key => (
                  <th key={key} className="px-2 py-1 text-left font-medium text-muted-foreground border-r border-border/50 last:border-r-0">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data as Array<Record<string, JSONValue>>).map((row, index) => (
                <tr key={index} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                  {keys.map(key => (
                    <td key={key} className="px-2 py-1 border-r border-border/30 last:border-r-0 max-w-xs truncate">
                      {renderValue(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // If it's a single object, render as key-value pairs
    if (!Array.isArray(data)) {
      return (
        <div className="space-y-1">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex items-start gap-2 text-xs">
              <div className="font-medium text-muted-foreground min-w-0 flex-shrink-0 w-24">
                {key}:
              </div>
              <div className="flex-1 min-w-0">
                {renderValue(value, key)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  const isTableData = () => {
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') return true;
    if (!Array.isArray(data) && typeof data === 'object') return true;
    return false;
  };

  return (
    <Card className={cn("p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {title && (
            <h4 className="font-medium text-sm text-foreground">{title}</h4>
          )}
          <Badge variant="secondary" className="text-xs">
            {Array.isArray(data) ? `Array (${data.length})` : 'Object'}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {showCopyButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={copyToClipboard}
              className="h-6 px-2 text-xs"
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowRaw(!showRaw)}
            className="h-6 px-2 text-xs"
          >
            {showRaw ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            {showRaw ? 'Table' : 'Raw'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-6 px-2 text-xs"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-1">
          {showRaw ? (
            <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
              <code>{JSON.stringify(data, null, 2)}</code>
            </pre>
          ) : isTableData() ? (
            renderTable(data)
          ) : (
            <div className="font-mono text-xs">
              {renderValue(data)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
