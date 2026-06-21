---
applyTo: "**/*Controller.java"
---
# Controller Layer

- Annotate with `@RestController` and `@RequestMapping`
- Keep controllers thin — HTTP handling only, delegate logic to services
- Validate inputs with `@Valid` on method parameters
- Return `ResponseEntity<T>` for full HTTP response control
- Test with `@WebMvcTest` and `MockMvc` — do NOT load full context
