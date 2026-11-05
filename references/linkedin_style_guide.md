# LinkedIn writing and visual style guide

## Evidence
Derived from the reference posts pasted by the user: agent explainers, research breakdowns, tool roundups, project lessons, governance posts, and agent-building guides. The live LinkedIn activity page was inaccessible on 2026-10-21. All 16 supplied screenshot references were visually inspected on 2026-10-21. They inform static composition, hierarchy, and diagram structure. The animation preference below comes from the user's direct feedback and approved generated GIF. The user reports that approximately 90% are animated flow diagrams. Do not treat PNG screenshots as evidence of actual motion.

## Consistent writing patterns
- A short opening creates a gap between a familiar belief and a practical consequence.
- Simple words, direct address, contractions, and short sentences make technical subjects approachable.
- White space separates thoughts; numbered sections and arrows make explanations scannable.
- One familiar example carries the explanation: an email, shipment, support ticket, or agent task.
- Components are explained through their job, an example, and often a limitation.
- A practical takeaway connects the explanation to what readers should build, check, or change.
- Many posts close with a specific question and repeated promotional footer. Keep useful questions; do not inherit the personal tagging or repetitive promotion.

## Patterns that vary
Personal failure stories suit honest project lessons. Numbered breakdowns suit explanations. Category lists suit curated resources. Benchmarks and quoted talks appear in source-driven posts and require independent verification. Not every post needs a contrarian opener, five steps, emoji, analogy, or long body.

## User voice
Write as an AI engineer explaining systems, automation, tools, and engineering decisions on their own LinkedIn profile. Concrete, calm, candid, useful. Adapt the reference creator's hooks, pacing, explanatory structure, and accessible technical language while keeping the user's own identity and facts. Explain implementation choices through their effect on system behavior and, where relevant, the business. Earn authority through evidence rather than grand claims. Use first person only for the user's confirmed experience.

Choose the audience for each topic; do not assume every post targets business owners or sells automation services. Follow the reference creator's topic-selection patterns as well as her writing style. The earlier industry-specific direction is discarded.

## Topic-selection patterns
Use the supplied posts and visual references to identify useful AI engineering subjects: how agents work, agent components and architecture, research explained practically, tool and resource roundups, building and deployment guides, governance, and engineering lessons. Create original posts within those patterns rather than repackaging one industry workflow into multiple ideas. Specific tools, research findings, and current developments need source verification. Personal lessons require confirmed user experience.

## Original hook examples
- "The chatbot answered the question. The customer still couldn't book."
- "Before giving an agent a tool, define what happens when that tool fails."
- "A correct answer can still leave a support ticket unresolved."
- "The demo worked. The failure path needed its own design."
These are possible hooks, not claims that the user has completed these projects.

## Post structures
1. Explanation: hook → concrete scenario → parts and limitations → useful takeaway.
2. Project demo: problem → what was actually built → short walkthrough → observed result or testing limit → next step.
3. Lesson: confirmed expectation → observed failure → cause → change → evidence and remaining uncertainty.
4. Business workflow: customer problem → current handoffs → proposed improvement → exception path → what to measure.
5. Research/tool brief: verified source → what changed → how it works → limitations → who should care.

## Formatting
Keep paragraphs to one idea, usually one to three short sentences. Use a few numbered steps or arrows only when they help scanning. Avoid excessive Unicode bold, emoji, hashtags, forced questions, and automatic repost requests. Avoid dense introductions, corporate filler, hype, and claims that every new tool changes everything. Length follows substance.

## Visual direction
One idea per visual. Prefer an animated flow diagram when sequence, data movement, routing, or feedback matters. Use a screenshot for genuine product evidence, a static diagram for a simple relationship, or a carousel when several frames are needed. Brief headline, clear hierarchy, generous margins, consistent labels, strong contrast. Use the inspected references for composition and hierarchy, and the approved generated GIF for the user’s preferred motion. Do not infer original animation behavior from screenshots.

### Reference-led composition, not one repeated template
Use `visual_reference_catalog.md` to locate and inspect original reference images for each topic. Their range includes illustrated analogies, three-column comparisons, branching diagnostics, radial component maps, numbered roadmaps, lifecycle loops, layered system architectures, grouped resource lists, and split visual metaphors.

Match the structure to the reader's question. A decision needs branches; component relationships may need a radial map; a tool collection needs clear categories; a foundations lesson may suit an illustration. The approved GIF locks the motion preference only. It does not require the same paired-box grid, colors, or layout on every post. Reusing the old renderer with different labels is not sufficient design work.

Review recent saved visuals before deciding. Vary composition meaningfully when the topic changes. Flow dots belong on real data or control paths; use other restrained emphasis or a static treatment when a reference-led illustration, comparison or resource directory fits better. Record selected screenshots and the design rationale in `notes.md`.

### Locked animation style
For a flow-based visual, the default deliverable is a downloadable animated GIF that reads like a polished diagram with continuous data flowing through it. Use `outputs/timeout-retries/timeout-stream-fast.gif` as the approved motion reference. Its two-second seamless loop is the preferred speed baseline; `outputs/timeout-retries/render_loop.py` contains the editable design, before the approved two-times timing adjustment.

Keep nodes, boxes, and labels stationary and readable. Animate dots or dashes along directional connections at a brisk, easy-to-follow speed. Keep the signal phase continuous across the loop boundary. Do not make the diagram disappear and rebuild on every repeat.

Two-to-five-second loops suit simple diagrams. Longer than five seconds is allowed for explanations that need timed reveals, hiding/showing elements, or progressive activation. After the reveal, keep the completed diagram in place with ongoing data-flow motion. “Pause at the end” means pause the layout changes while the signals keep moving indefinitely.

A standard GIF cannot run an intro once and then loop only the final section: it repeats the whole sequence. Use the seamless completed-diagram GIF as the primary deliverable; provide any useful intro separately, or use a format that actually supports a one-time intro and persistent tail. Never misrepresent a full replay as a tail-only loop.

Deliver the actual GIF, a cover, and editable source where feasible. MP4 is optional only when requested or required for a verified destination. Review the loop in motion, including its seam, signal speed, palette stability, clipping, and phone readability. See SYSTEM_PROMPT.md for the full export and verification rules.

## Required saved post package
Every finished post must be saved in its own `linkedin_posts/YYYY-MM-DD-topic-slug/` folder with `post.txt` and the matching final image/GIF or original video file. For an external video, include `video-link.md` with a verified direct watch link and the source-video Gemini prompt. Keep sources, caveats, and media details in `notes.md`; update `linkedin_posts/README.md`. Revisions update the same package. Follow the full folder-delivery rules in SYSTEM_PROMPT.md.

## Avoid
Copying the creator's biography, signature language, or outcomes; individual tags; fabricated project evidence; unsupported savings; repeating the same idea with a different hook; technically false simplifications; claiming screenshots reveal original animation software. Important company tags are allowed only when relevant.

See SYSTEM_PROMPT.md for the full workflow, factual checks, and source-video/Gemini timestamp requirements.


## Default scope and starting request
Default to broad AI engineering and automation content informed by the supplied references: agent architecture, harnesses, memory, RAG, MCP, skills, evaluations, research, tools, and engineering lessons. Do not default to HVAC, lead generation, or an industry sales niche. An industry-specific example does not permanently change this positioning. Only narrow a task when the user deliberately requests that industry; do not carry the restriction into later tasks.

For an unrestricted ideas request, offer five genuinely different topics across these categories, rather than five variations of a booking or customer-service workflow. Recommend one and wait for selection.

Suggested starting request: "Apply the saved content system. Suggest five original LinkedIn post ideas across AI engineering, agents, automation, tools, and research, using the supplied references for topic patterns and writing techniques. Do not invent personal experience or results. Recommend the strongest idea and wait for my selection."
