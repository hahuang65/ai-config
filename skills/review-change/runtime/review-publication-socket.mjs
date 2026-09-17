import { fstatSync } from "node:fs";

export function validateInheritedPublicationSocket({
  inputDescriptor = 0,
  outputDescriptor = 1,
  descriptorState = fstatSync,
} = {}) {
  let input;
  let output;
  try {
    input = descriptorState(inputDescriptor);
    output = descriptorState(outputDescriptor);
  } catch {
    throw inheritedSocketError();
  }
  if (!input.isSocket() || !output.isSocket() || input.dev !== output.dev || input.ino !== output.ino) {
    throw inheritedSocketError();
  }
}

function inheritedSocketError() {
  return new Error("Review publication requires one inherited accepted socket on standard input and output. Repair the user service installation, then try again.");
}
