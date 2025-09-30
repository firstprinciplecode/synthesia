"use client";

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { JsonFormatter } from '@/components/ui/json-formatter';

interface JsonMarkdownRendererProps {
  content: string;
  className?: string;
}

export function JsonMarkdownRenderer({ content, className }: JsonMarkdownRendererProps) {
  const isGoogleNews = /(^|\n)\s*Google News for\s*"/i.test(content);
  const isXSearch = /(^|\n)\s*X search for\s*"/i.test(content);
  // Preprocess content to fix malformed markdown links
  const preprocessContent = (text: string) => {
    // 1) Fix malformed links split across lines:
    //    [Label]\n(URL) -> [Label](URL)
    text = text.replace(/\]\s*\n\s*\((https?:[^)]+)\)/g, '](#$1#)');
    // 2) Also fix inline spaces: [Label] (URL) -> [Label](URL)
    text = text.replace(/\]\s*\(/g, '](');
    // 3) Restore protected URLs
    text = text.replace(/\(#(https?:[^)]+)#\)/g, '($1)');

    // 4) Fix images split across lines:
    //    ![alt]\n(URL) -> ![alt](URL)
    text = text.replace(/!\[([^\]]*)\]\s*\n\s*\((https?:[^)]+)\)/g, '![$1](#$2#)');
    // 5) Handle fallback '[image]\n(URL)' -> '![image](URL)'
    text = text.replace(/\[image\]\s*\n\s*\((https?:[^)]+)\)/gi, '![image](#$1#)');
    // 6) Restore protected image URLs
    text = text.replace(/!\[([^\]]*)\]\(#(https?:[^)]+)#\)/g, '![$1]($2)');
    // 7) If a stray '!' ended up on the previous line before an image or [View], drop it
    //    '... UTC !\n![image](url)' or '... UTC !\n[View](url)' -> '... UTC\n...'
    text = text.replace(/!\s*\n\s*(?=(?:!\[|\[))/g, '\n');
    return text;
  };

  // Allow data:audio links to render inline while keeping others safe
  const urlTransform = (uri: string) => {
    try {
      if (typeof uri !== 'string') return uri as any;
      if (uri.startsWith('data:audio')) return uri;
      if (uri.startsWith('http:') || uri.startsWith('https:') || uri.startsWith('/')) return uri;
      return '#';
    } catch {
      return '#';
    }
  };
  
  const markdownComponents = {
    img: (props: any) => (
      <img
        {...props}
        alt={props.alt || ''}
        className={`mt-2 ${
          isGoogleNews
            ? 'float-left mr-3 w-20 h-20 object-cover' // Google News: 80x80
            : isXSearch
            ? 'float-left mr-3 w-10 h-10 object-cover' // X avatar: 40x40
            : 'max-w-full'
        } ${isXSearch ? 'rounded-full' : 'rounded-md'} border ${props.className || ''}`}
      />
    ),
    a: (props: any) => {
      const href = props.href as string | undefined;
      if (href && href.startsWith('data:audio')) {
        return (
          <audio controls className="mt-2 w-full">
            <source src={href} />
            Your browser does not support the audio element.
          </audio>
        );
      }
      return <a {...props} target="_blank" rel="noreferrer" className="underline hover:no-underline" />
    },
    hr: (props: any) => (
      <hr {...props} className={`clear-both my-4 border-border/60 ${props.className || ''}`} />
    ),
    p: (props: any) => (
      <p {...props} className={`leading-relaxed mb-2 last:mb-0 ${props.className || ''}`} />
    ),
    ul: (props: any) => <ul {...props} className={`list-disc pl-5 space-y-1 ${props.className || ''}`} />,
    ol: (props: any) => <ol {...props} className={`list-decimal pl-5 space-y-1 ${props.className || ''}`} />,
    li: (props: any) => <li {...props} className={`leading-relaxed ${props.className || ''}`} />,
    strong: (props: any) => <strong {...props} className={`font-semibold ${props.className || ''}`} />,
    em: (props: any) => <em {...props} className={`italic ${props.className || ''}`} />,
  } as any;
  // Function to detect and extract JSON blocks (fenced only)
  const processContent = (text: string) => {
    // Preprocess the text to fix malformed markdown links
    const processedText = preprocessContent(text);
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/g;
    const parts: Array<{ type: 'text' | 'json'; content: string; data?: any }> = [];
    let lastIndex = 0;
    let match;

    while ((match = jsonRegex.exec(processedText)) !== null) {
      // Add text before JSON block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: processedText.slice(lastIndex, match.index)
        });
      }

      // Try to parse JSON
      try {
        const jsonData = JSON.parse(match[1]);
        parts.push({
          type: 'json',
          content: match[1],
          data: jsonData
        });
      } catch (e) {
        // If parsing fails, treat as regular text
        parts.push({
          type: 'text',
          content: processedText.slice(match.index, match.index + match[0].length)
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text (no naive inline JSON detection to avoid breaking markdown)
    if (lastIndex < processedText.length) {
      parts.push({
        type: 'text',
        content: processedText.slice(lastIndex)
      });
    }

    return parts.length > 0 ? parts : [{ type: 'text', content: processedText }];
  };

  const parts = processContent(content);

  return (
    <div className={className}>
      {parts.map((part, index) => {
        if (part.type === 'json' && part.data) {
          return (
            <div key={index} className="my-4">
              <JsonFormatter 
                data={part.data} 
                title="JSON Response"
                defaultExpanded={true}
                showCopyButton={true}
              />
            </div>
          );
        } else {
          return (
            <div key={index} className={`prose prose-sm max-w-none ${isGoogleNews || isXSearch ? 'overflow-hidden' : ''}`}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={urlTransform}
              >
                {part.content}
              </ReactMarkdown>
            </div>
          );
        }
      })}
    </div>
  );
}
