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
  // Preprocess content to fix malformed markdown links
  const preprocessContent = (text: string) => {
    // Fix malformed links: [Title] (https://url.com) -> [Title](https://url.com)
    return text.replace(/\]\s*\(/g, '](');
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...props}
        alt={props.alt || ''}
        className={`mt-2 max-w-full rounded-md border ${props.className || ''}`}
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
  } as any;
  // Function to detect and extract JSON blocks
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

    // Add remaining text
    if (lastIndex < processedText.length) {
      const remainingText = processedText.slice(lastIndex);
      
      // Also check for standalone JSON objects/arrays in the remaining text
      const standaloneJsonRegex = /(\{[\s\S]*?\}|\[[\s\S]*?\])/g;
      let jsonMatch;
      let textIndex = 0;
      
      while ((jsonMatch = standaloneJsonRegex.exec(remainingText)) !== null) {
        // Add text before JSON
        if (jsonMatch.index > textIndex) {
          parts.push({
            type: 'text',
            content: remainingText.slice(textIndex, jsonMatch.index)
          });
        }
        
        // Try to parse JSON
        try {
          const jsonData = JSON.parse(jsonMatch[1]);
          parts.push({
            type: 'json',
            content: jsonMatch[1],
            data: jsonData
          });
        } catch (e) {
          // If parsing fails, treat as regular text
          parts.push({
            type: 'text',
            content: jsonMatch[0]
          });
        }
        
        textIndex = jsonMatch.index + jsonMatch[0].length;
      }
      
      // Add any remaining text
      if (textIndex < remainingText.length) {
        parts.push({
          type: 'text',
          content: remainingText.slice(textIndex)
        });
      }
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
            <div key={index} className="prose prose-sm max-w-none">
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
