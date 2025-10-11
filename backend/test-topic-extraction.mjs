// Test topic extraction logic
function extractTopic(userMessage) {
  const text = userMessage.toLowerCase();
  
  // Extract quoted text or "about X" pattern
  const quoted = (userMessage.match(/"([^"]+)"/) || [])[1];
  const about = (text.match(/about\s+([\w\s\-\_\.\#\@]+)\??$/) || [])[1];
  
  // Strip conversational filler and focus on the noun phrase
  let fallback = text
    .replace(/\b(alright|ok|okay|well|so|now|hey|hi|hello)\b/gi, '') // conversational starters
    .replace(/\b(let's|lets|can you|could you|please|would you)\b/gi, '') // politeness
    .replace(/\b(see|check|look at|find|get|show|fetch|tell me|give me|show me|get me)\b/gi, '') // action verbs
    .replace(/\b(what's|whats|what is)\b/gi, '') // question words
    .replace(/\b(going on|happening|new|up)\b/gi, '') // status words
    .replace(/\b(with the|in the world of|in|on|at|regarding)\b/gi, '') // prepositions
    .replace(/\b(latest|today|recent|current|headlines|news|now)\b/gi, '') // time/type words
    .replace(/\bfrom\s+google\s+news\b/gi, '')
    .replace(/\s+me\s+/gi, ' ') // "tell me", "show me" remnants
    .trim();
  
  let hintRaw = String(quoted || about || fallback || userMessage).trim();
  hintRaw = hintRaw
    .replace(/\bfrom\s+google\s+news\b/gi, ' ')
    .replace(/[\)\(\:"\]]+$/g, ' ')
    .replace(/^\s*(the|a|an)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  // Special cases
  if (/favorite\s+space\s+company/i.test(hintRaw)) hintRaw = 'SpaceX';
  
  return hintRaw || 'news';
}

const testCases = [
  {
    input: "Alright lets see what's going on in the world of space exploration today",
    expected: "space exploration"
  },
  {
    input: "can you get me the latest news about Tesla",
    expected: "tesla" // lowercase is fine for searches
  },
  {
    input: "what's happening with the election today",
    expected: "election"
  },
  {
    input: "show me recent headlines on AI",
    expected: "ai" // lowercase is fine
  },
  {
    input: "tell me about climate change news",
    expected: "climate change" // "news" should be removed
  },
  {
    input: "latest on SpaceX launches",
    expected: "spacex launches" // lowercase is fine
  }
];

console.log('\n=== Topic Extraction Tests ===\n');

let passed = 0;
let failed = 0;

testCases.forEach((test, i) => {
  const result = extractTopic(test.input);
  const success = result === test.expected;
  
  console.log(`Test ${i + 1}: ${success ? '✅' : '❌'}`);
  console.log(`  Input:    "${test.input}"`);
  console.log(`  Expected: "${test.expected}"`);
  console.log(`  Got:      "${result}"`);
  console.log('');
  
  if (success) passed++;
  else failed++;
});

console.log(`Results: ${passed} passed, ${failed} failed`);

