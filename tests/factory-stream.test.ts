import { describe, expect, it } from "vitest";
import { messageForCycleEvent, sse } from "../src/factory-stream.js";

describe("factory stream presentation",()=>{
  it("turns structured lifecycle events into readable messages",()=>{
    expect(messageForCycleEvent({id:"1",type:"factory.planning.completed",payload:JSON.stringify({steps:3}),created_at:""})).toBe("Engineering plan ready — 3 steps identified.");
    expect(messageForCycleEvent({id:"2",type:"tool.call",payload:JSON.stringify({toolName:"ai_factory_create_box"}),created_at:""})).toContain("ai_factory_create_box");
    expect(messageForCycleEvent({id:"3",type:"model.message",payload:JSON.stringify({content:"Here is the result."}),created_at:""})).toBe("Here is the result.");
  });

  it("renders the canonical conversational assistant event",()=>{
    const event={id:"4",type:"factory.conversation.assistant",payload:JSON.stringify({message:"What would you like to build?",mode:"conversation"}),created_at:""};
    expect(messageForCycleEvent(event)).toBe("What would you like to build?");
  });

  it("does not render the removed duplicate conversation response event",()=>{
    expect(messageForCycleEvent({id:"5",type:"factory.conversation.response",payload:JSON.stringify({message:"duplicate"}),created_at:""})).toBeNull();
  });

  it("serializes SSE frames without mixing structured JSON into message text",()=>{
    const frame=sse("message",{role:"assistant",text:"Readable answer"});
    expect(frame).toContain("event: message");
    expect(frame).toContain('"text":"Readable answer"');
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});
